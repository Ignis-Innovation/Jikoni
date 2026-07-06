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
    if (error) setErr(error.message);
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
            <div style={{ fontWeight: 700, fontSize: 16 }}>Jikoni</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>CleanCookIQ · Ignis</div>
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
