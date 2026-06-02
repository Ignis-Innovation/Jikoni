import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Select, Badge } from "@/components/ui/primitives";
import { SlideOver } from "@/components/data/SlideOver";
import { formatDate } from "@/lib/utils";
import { Plus } from "lucide-react";

const statusTone: Record<string, "green" | "amber" | "red"> = { active: "green", invited: "amber", suspended: "red" };

// Throwaway client (no session persistence) so creating a user doesn't replace
// the admin's own session. The service_role key is never shipped to the SPA.
function tempClient() {
  return createClient(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "jikoni-invite-temp" },
  });
}

function randomPassword() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  for (const n of arr) s += c[n % c.length];
  return s + "9!";
}

export default function Users() {
  const { user } = useAuth();
  const { data, loading, reload } = useData(async () => {
    const [{ data: users }, { data: roles }] = await Promise.all([
      supabase.from("users").select("id, full_name, email, status, last_login_at, user_roles(roles(key))").is("deleted_at", null).order("created_at"),
      supabase.from("roles").select("key, name").order("name"),
    ]);
    return { users: users ?? [], roles: roles ?? [] };
  }, []);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!can(user, "identity.users.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to Users.</p>;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const pw = randomPassword();
    const tc = tempClient();
    const { data: created, error } = await tc.auth.signUp({ email, password: pw, options: { data: { full_name: fullName || email } } });
    if (error) { setBusy(false); setMsg(error.message); return; }
    const newId = created.user?.id;
    if (newId) {
      await supabase.from("users").update({ full_name: fullName || email }).eq("id", newId);
      const { data: r } = await supabase.from("roles").select("id").eq("key", role).single();
      if (r) await supabase.from("user_roles").upsert({ user_id: newId, role_id: r.id }, { onConflict: "user_id,role_id" });
    }
    setBusy(false);
    setMsg(`Invited ${email} as ${role}. Temp password: ${pw} (share it, or have them use “Forgot password”).`);
    setEmail(""); setFullName("");
    reload();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Settings</p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">Identity &amp; access — invite people and assign roles.</p>
        </div>
        {can(user, "identity.users.create") && (
          <Button onClick={() => { setMsg(null); setOpen(true); }}><Plus className="h-4 w-4" /> Invite user</Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Roles</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Last login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {((data?.users ?? []) as any[]).map((u) => (
              <tr key={u.id} className="hover:bg-muted/50">
                <td className="px-4 py-2.5 font-medium text-foreground">{u.full_name ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(u.user_roles ?? []).map((ur: any, i: number) => <Badge key={i} tone="blue">{ur.roles?.key}</Badge>)}
                  </div>
                </td>
                <td className="px-4 py-2.5"><Badge tone={statusTone[u.status] ?? "zinc"}>{u.status}</Badge></td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.last_login_at ? formatDate(u.last_login_at) : "—"}</td>
              </tr>
            ))}
            {!loading && (data?.users.length ?? 0) === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No users.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <SlideOver open={open} title="Invite user" onClose={() => setOpen(false)}>
        <form onSubmit={invite} className="space-y-4">
          <div><Label required>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label>Full name</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div>
            <Label required>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {(data?.roles ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          </div>
          {msg && <p className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">{msg}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={busy || !email}>{busy ? "Inviting…" : "Create user"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
