import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button, Input, Label } from "@/components/ui/primitives";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-destructive/5 px-4 py-20">
        <div className="w-full max-w-xl rounded-3xl border border-destructive/30 bg-card p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-destructive">Deployment configuration missing</h1>
          <p className="mt-3 text-sm text-foreground/80">
            Jikoni needs Supabase environment variables to run. Please set
            <strong className="text-foreground"> VITE_SUPABASE_URL </strong> and
            <strong className="text-foreground"> VITE_SUPABASE_ANON_KEY </strong>
            in your Vercel project settings and redeploy.
          </p>
        </div>
      </div>
    );
  }

  // Already signed in → bounce to where they came from (or home).
  if (!loading && user) {
    const to = (location.state as { from?: string } | null)?.from ?? "/";
    navigate(to, { replace: true });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{
              background: "radial-gradient(circle at 50% 120%, var(--ember) 0%, #8a2f12 70%)",
              boxShadow: "0 0 18px -4px var(--ember)",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
              <path
                d="M12 2c1 3-1 4-1 6 0 1.5 1 2.2 1 2.2S14 9 14 7c2 1.5 4 4 4 7a6 6 0 1 1-12 0c0-2 1-3.5 2-4.5.2 1.2 1 2 1 2 .3-3 2-4.5 3-9.5Z"
                fill="#fff"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Jikoni</h1>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Ignis Operating System</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-7 shadow-sm">
          <div className="mb-1">
            <h2 className="text-base font-semibold text-foreground">Sign in</h2>
            <p className="text-xs text-muted-foreground">Welcome back — enter your credentials.</p>
          </div>
          <div>
            <Label htmlFor="email" required>Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password" required>Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="text-center">
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
          </div>
        </form>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Jikoni — one shared spine, modules by reference.</p>
      </div>
    </div>
  );
}
