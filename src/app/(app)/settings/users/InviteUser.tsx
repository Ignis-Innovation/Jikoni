"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { SlideOver } from "@/components/data/SlideOver";
import { Plus } from "lucide-react";
import { inviteUser } from "./actions";

export function InviteUser({ roles }: { roles: { key: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("email", email);
    fd.set("full_name", fullName);
    fd.set("role", role);
    const res = await inviteUser(fd);
    setBusy(false);
    setMsg(res.message);
    if (res.ok) {
      setEmail("");
      setFullName("");
      router.refresh();
      setTimeout(() => setOpen(false), 800);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Invite user
      </Button>
      <SlideOver open={open} title="Invite user" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label required>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label required>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          </div>
          {msg && <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">{msg}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={busy || !email}>{busy ? "Inviting…" : "Send invite"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}
