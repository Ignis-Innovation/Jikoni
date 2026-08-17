// Phase 0 auth gate — Supabase Auth, login only: "who is logged in", nothing more.
import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { BrandMark } from "./icons";
import { PasswordInput } from "./PasswordInput";

const labelStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: "var(--ink-soft)", letterSpacing: 0.4,
  textTransform: "uppercase", display: "block", marginBottom: 6,
};

export function LoginGate() {
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // confirmation shown after a reset request

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(/banned/i.test(error.message) ? "This account is closed — your exit was finalised. Contact HR if you think this is wrong." : error.message);
    setBusy(false);
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "Couldn't send the reset link. Try again."); setBusy(false); return; }
      // Always generic — never reveals whether the email is registered.
      setSent(data.message || "If that email is registered, a reset link is on its way.");
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  function goForgot() { setMode("forgot"); setErr(null); setSent(null); setPassword(""); }
  function goSignin() { setMode("signin"); setErr(null); setSent(null); }

  const linkStyle: React.CSSProperties = {
    fontSize: 12.5, color: "var(--flame)", cursor: "pointer", fontWeight: 600, background: "none", border: "none", padding: 0,
  };

  if (mode === "forgot") {
    return (
      <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--counter)" }}>
        <form onSubmit={sendReset} style={{ width: 360, background: "#fff", border: "1px solid var(--hairline-2)", borderRadius: 16, padding: "28px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="mark"><BrandMark /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Reset your password</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Jikoni Tool</div>
            </div>
          </div>
          {sent ? (
            <>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{sent}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Open the link in that email to choose a new password, then sign in.</div>
              <button type="button" className="btn" onClick={goSignin} style={{ justifyContent: "center" }}>Back to sign in</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Enter your email and we'll send you a link to set a new password.
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input className="field" type="email" autoComplete="email" style={{ width: "100%" }}
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ignis.africa" />
              </div>
              {err && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{err}</div>}
              <button className="btn primary" type="submit" disabled={busy || !email.trim()} style={{ justifyContent: "center" }}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <button type="button" onClick={goSignin} style={{ ...linkStyle, alignSelf: "center" }}>Back to sign in</button>
            </>
          )}
        </form>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--counter)" }}>
      <form
        onSubmit={signIn}
        style={{
          width: 360, background: "#fff", border: "1px solid var(--hairline-2)",
          borderRadius: 16, padding: "28px 26px", display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="mark"><BrandMark /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Jikoni Tool</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Operations Suite</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          Sign in — every action is recorded against your name.
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input className="field" type="email" autoComplete="email" style={{ width: "100%" }}
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ignis.africa" />
        </div>
        <div>
          <label style={labelStyle}>Password</label>
          <PasswordInput autoComplete="current-password" wrapStyle={{ width: "100%" }} style={{ width: "100%" }}
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {err && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" onClick={goForgot} style={{ ...linkStyle, alignSelf: "center" }}>Forgot password?</button>
      </form>
    </div>
  );
}

// Shown when an invitee (or a password reset) arrives via the emailed link:
// Supabase has already established a session from the URL token, so we just let
// them choose the password they'll use from now on.
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) { setErr("Use at least 8 characters."); return; }
    if (password !== confirm) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    // drop the token from the URL so a refresh doesn't re-trigger this screen
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    onDone();
  }

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--counter)" }}>
      <form onSubmit={save} style={{ width: 360, background: "#fff", border: "1px solid var(--hairline-2)", borderRadius: 16, padding: "28px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="mark"><BrandMark /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Set your password</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Jikoni Tool</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          Choose the password you'll use to sign in from now on.
        </div>
        <div>
          <label style={labelStyle}>New password</label>
          <PasswordInput autoComplete="new-password" wrapStyle={{ width: "100%" }} style={{ width: "100%" }}
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <div>
          <label style={labelStyle}>Confirm password</label>
          <PasswordInput autoComplete="new-password" wrapStyle={{ width: "100%" }} style={{ width: "100%" }}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter it" />
        </div>
        {err && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Saving…" : "Save password & continue"}
        </button>
      </form>
    </div>
  );
}
