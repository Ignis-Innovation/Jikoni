// Phase 0 auth gate — Supabase Auth, login only: "who is logged in", nothing more.
// Full-bleed brand video background + a frosted-glass card; sign-in and
// forgot-password crossfade smoothly inside the same card. Auth logic is
// unchanged — only the presentational shell around it.
import React, { useState, useRef, useLayoutEffect } from "react";
import { supabase } from "../lib/supabase";
import { BrandMark } from "./icons";
import { PasswordInput } from "./PasswordInput";

// Full-viewport looping brand video with a poster fallback. Reduced-motion
// visitors get the still poster instead of the playing video.
function LoginBg() {
  const reduce = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
  return (
    <div className="login-bg" aria-hidden="true">
      {reduce
        ? <img src="/orbis-login.jpg" alt="" />
        : <video autoPlay loop muted playsInline preload="metadata" poster="/orbis-login.jpg"><source src="/orbis-login.mp4" type="video/mp4" /></video>}
    </div>
  );
}

// Glass card shell shared by every auth screen. `single` skips the height
// animation for one-panel screens (Set password).
function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LoginBg />
      <div className="login-stage">
        <div className="login-card">{children}</div>
        <div className="login-foot">Protected workspace · Ignis Innovation</div>
      </div>
    </>
  );
}

function Brand({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="login-brand">
      <div className="tile"><BrandMark /></div>
      <div><div className="nm">{title}</div><div className="sb">{sub}</div></div>
    </div>
  );
}

export function LoginGate() {
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // confirmation shown after a reset request

  const wrapRef = useRef<HTMLDivElement>(null);
  const signinRef = useRef<HTMLDivElement>(null);
  const forgotRef = useRef<HTMLDivElement>(null);
  // Animate the card height to whichever panel is active (smooth flow between
  // sign-in and forgot-password). Re-measure when content changes (error, sent).
  useLayoutEffect(() => {
    const el = mode === "signin" ? signinRef.current : forgotRef.current;
    if (el && wrapRef.current) wrapRef.current.style.height = el.offsetHeight + "px";
  }, [mode, sent, err, busy]);

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

  function go(m: "signin" | "forgot") { setMode(m); setErr(null); if (m === "signin") setSent(null); }

  return (
    <LoginShell>
      <Brand title="Jikoni Tool" sub="Operations Suite" />
      <div className="login-switch" ref={wrapRef}>
        {/* SIGN IN */}
        <div ref={signinRef} className={`login-panel ${mode === "signin" ? "in" : "out-left"}`}>
          <form onSubmit={signIn}>
            <h1 className="login-h1">Welcome back</h1>
            <p className="login-lede">Sign in — every action is recorded against your name.</p>
            <div className="login-fg">
              <label>Email</label>
              <input className="login-input" type="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@ignis.africa" />
            </div>
            <div className="login-fg">
              <label>Password</label>
              <span className="login-pw">
                <PasswordInput autoComplete="current-password" wrapStyle={{ width: "100%" }} className="login-input"
                  value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </span>
            </div>
            {err && mode === "signin" && <div className="login-err">{err}</div>}
            <button className="login-btn" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
            <div className="login-alt"><button type="button" className="login-link" onClick={() => go("forgot")}>Forgot password?</button></div>
          </form>
        </div>

        {/* FORGOT PASSWORD */}
        <div ref={forgotRef} className={`login-panel ${mode === "forgot" ? "in" : "out-right"}`}>
          <form onSubmit={sendReset}>
            <h1 className="login-h1">Reset password</h1>
            {sent ? (
              <>
                <div className="login-ok">{sent}</div>
                <p className="login-lede" style={{ marginTop: 12 }}>Open the link in that email to choose a new password, then sign in.</p>
                <div className="login-alt"><button type="button" className="login-link" onClick={() => go("signin")}>Back to sign in</button></div>
              </>
            ) : (
              <>
                <p className="login-lede">Enter your email and we'll send a link to set a new one.</p>
                <div className="login-fg">
                  <label>Email</label>
                  <input className="login-input" type="email" autoComplete="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="you@ignis.africa" />
                </div>
                {err && mode === "forgot" && <div className="login-err">{err}</div>}
                <button className="login-btn" type="submit" disabled={busy || !email.trim()}>{busy ? "Sending…" : "Send reset link"}</button>
                <div className="login-alt"><button type="button" className="login-link" onClick={() => go("signin")}>Back to sign in</button></div>
              </>
            )}
          </form>
        </div>
      </div>
    </LoginShell>
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
    <LoginShell>
      <Brand title="Set your password" sub="Jikoni Tool" />
      <form onSubmit={save} className="login-panel in login-single">
        <p className="login-lede">Choose the password you'll use to sign in from now on.</p>
        <div className="login-fg">
          <label>New password</label>
          <span className="login-pw">
            <PasswordInput autoComplete="new-password" wrapStyle={{ width: "100%" }} className="login-input"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </span>
        </div>
        <div className="login-fg">
          <label>Confirm password</label>
          <span className="login-pw">
            <PasswordInput autoComplete="new-password" wrapStyle={{ width: "100%" }} className="login-input"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter it" />
          </span>
        </div>
        {err && <div className="login-err">{err}</div>}
        <button className="login-btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password & continue"}</button>
      </form>
    </LoginShell>
  );
}
