import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button, Input, Label } from "@/components/ui/primitives";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900">Reset password</h1>
        {sent ? (
          <p className="text-sm text-zinc-600">If an account exists for <b>{email}</b>, a reset link is on its way.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-zinc-500">Enter your email and we&apos;ll send a reset link.</p>
            <div>
              <Label htmlFor="email" required>Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={!email}>Send reset link</Button>
          </form>
        )}
        <div className="mt-4 text-center">
          <Link to="/login" className="text-xs text-emerald-700 hover:underline">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
