import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { sendSalesEmail } from "@/lib/salesApi";
import { Button, Input, Label, Select, Badge, PageHeader, Table, THead, TBody, TH, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatDate, statusTone } from "@/lib/utils";
import { UserPlus, Building2 } from "lucide-react";

type Account = {
  party_id: string;
  approval_status: string;
  tier: string | null;
  parties: { display_name: string; email: string | null; phone: string | null } | null;
};

export default function Accounts() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const canApprove = can(user, "revenue.edit");

  const { data: rows, reload } = useData(async () => {
    const { data } = await supabase
      .from("customer_profiles")
      .select("party_id, approval_status, tier, parties(display_name, email, phone)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    return (data ?? []) as unknown as Account[];
  }, []);

  async function decide(a: Account, status: "approved" | "rejected") {
    setBusy(a.party_id);
    const patch: Record<string, unknown> = { approval_status: status };
    if (status === "approved") { patch.approved_at = new Date().toISOString(); patch.approved_by = user?.id; }
    const { error } = await supabase.from("customer_profiles").update(patch).eq("party_id", a.party_id);
    setBusy(null);
    if (error) return alert(error.message);
    if (status === "approved" && a.parties?.email) {
      sendSalesEmail(a.parties.email, "account_approved", { account_name: a.parties.display_name }).catch(() => {});
    }
    reload();
  }

  if (!can(user, "sales.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  const list = (rows ?? []).filter((a) => filter === "all" || a.approval_status === filter);

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="Sales" title="Accounts" subtitle="Leads & customers — new accounts wait for approval before ordering."
        icon={Building2}
        actions={can(user, "sales.create") && <Button onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" /> New account</Button>}
      />

      <div className="mb-4 flex gap-2">
        {(["all", "pending", "approved", "rejected"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "primary" : "outline"} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      <Table>
        <THead><TH>Account</TH><TH>Contact</TH><TH>Tier</TH><TH>Status</TH><TH /></THead>
        <TBody>
          {list.map((a) => (
            <TR key={a.party_id}>
              <TD className="font-medium text-foreground">{a.parties?.display_name ?? "—"}</TD>
              <TD>{a.parties?.email || a.parties?.phone || "—"}</TD>
              <TD>{a.tier || "—"}</TD>
              <TD><Badge tone={statusTone(a.approval_status)}>{a.approval_status}</Badge></TD>
              <TD className="text-right">
                {canApprove && a.approval_status === "pending" && (
                  <span className="flex justify-end gap-2">
                    <Button size="sm" disabled={busy === a.party_id} onClick={() => decide(a, "approved")}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy === a.party_id} onClick={() => decide(a, "rejected")}>Reject</Button>
                  </span>
                )}
              </TD>
            </TR>
          ))}
          {list.length === 0 && <TR><TD colSpan={5} className="py-12 text-center">No accounts.</TD></TR>}
        </TBody>
      </Table>

      {open && <NewAccount onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </div>
  );
}

function NewAccount({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ display_name: "", email: "", phone: "", tier: "standard" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.display_name.trim()) return alert("Company name is required");
    setBusy(true);
    const { data: party, error } = await supabase
      .from("parties")
      .insert({ type: "customer", display_name: form.display_name.trim(), email: form.email || null, phone: form.phone || null, status: "active" })
      .select("id").single();
    if (error || !party) { setBusy(false); return alert(error?.message || "Failed"); }
    const { error: profErr } = await supabase
      .from("customer_profiles")
      .insert({ party_id: party.id, tier: form.tier, approval_status: "pending" });
    setBusy(false);
    if (profErr) return alert(profErr.message);
    if (form.email) sendSalesEmail(form.email, "account_created", { account_name: form.display_name, contact_name: form.display_name }).catch(() => {});
    onDone();
  }

  return (
    <Modal open title="New account" onClose={onClose}>
      <div className="space-y-3">
        <div><Label required>Company name</Label><Input value={form.display_name} onChange={(e) => set("display_name", e.target.value)} /></div>
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07XX XXX XXX" /></div>
        <div><Label>Segment / tier</Label>
          <Select value={form.tier} onChange={(e) => set("tier", e.target.value)}>
            <option value="standard">Standard</option><option value="wholesale">Wholesale</option><option value="retail">Retail</option><option value="vip">VIP</option>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Created accounts start as <strong>pending</strong> until an admin approves them.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
        </div>
      </div>
    </Modal>
  );
}
