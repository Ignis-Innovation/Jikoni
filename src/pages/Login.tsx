import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-lg font-bold text-white">J</div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Jikoni</h1>
            <p className="text-xs text-zinc-500">Ignis Innovation OS</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div>
            <Label htmlFor="email" required>Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password" required>Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="text-center">
            <Link to="/forgot-password" className="text-xs text-emerald-700 hover:underline">Forgot password?</Link>
          </div>
        </form>
        <p className="mt-4 text-center text-[11px] text-zinc-400">Jikoni — one shared spine, modules by reference.</p>
      </div>
    </div>
  );
}
