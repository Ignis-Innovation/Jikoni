import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button, Input, Label } from "@/components/ui/primitives";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // PRD §1.1: min 10 chars, 1 number, 1 symbol.
  const valid = password.length >= 10 && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else {
      setDone(true);
      setTimeout(() => navigate("/login"), 1500);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-3 text-lg font-semibold text-zinc-900">Set a new password</h1>
        {done ? (
          <p className="text-sm text-emerald-700">Password updated. Redirecting to sign in…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="pw" required>New password</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <p className="mt-1 text-[11px] text-zinc-400">At least 10 characters, 1 number, 1 symbol.</p>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={!valid}>Update password</Button>
          </form>
        )}
      </div>
    </div>
  );
}
