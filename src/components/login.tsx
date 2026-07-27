// Phase 0 auth gate — Supabase Auth, login only: "who is logged in", nothing more.
import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { BrandMark } from "./icons";

const labelStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: "var(--ink-soft)", letterSpacing: 0.4,
  textTransform: "uppercase", display: "block", marginBottom: 6,
};

export function LoginGate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(/banned/i.test(error.message) ? "This account is closed — your exit was finalised. Contact HR if you think this is wrong." : error.message);
    setBusy(false);
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
          <input className="field" type="password" autoComplete="current-password" style={{ width: "100%" }}
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {err && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
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
          <input className="field" type="password" autoComplete="new-password" style={{ width: "100%" }}
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <div>
          <label style={labelStyle}>Confirm password</label>
          <input className="field" type="password" autoComplete="new-password" style={{ width: "100%" }}
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
