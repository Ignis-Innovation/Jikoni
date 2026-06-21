import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Select, PageHeader, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatMoney, formatDate } from "@/lib/utils";
import { Target as TargetIcon, Plus } from "lucide-react";

type Target = {
  id: string; rep_user_id: string; period_type: string;
  period_start: string; period_end: string; target_minor: number; currency_code: string;
};
type User = { id: string; full_name: string | null; email: string };

export default function Targets() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const canManage = can(user, "sales.edit");

  const { data, reload } = useData(async () => {
    const [{ data: targets }, { data: users }, { data: paid }] = await Promise.all([
      supabase.from("sales_targets").select("id, rep_user_id, period_type, period_start, period_end, target_minor, currency_code").is("deleted_at", null).order("period_start", { ascending: false }),
      supabase.from("users").select("id, full_name, email"),
      supabase.from("receivable_invoices").select("amount_minor, created_by, invoice_date").eq("status", "paid").is("deleted_at", null),
    ]);
    return { targets: (targets ?? []) as Target[], users: (users ?? []) as User[], paid: (paid ?? []) as { amount_minor: number; created_by: string | null; invoice_date: string | null }[] };
  }, []);

  if (!can(user, "sales.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  const userName = (id: string) => {
    const u = data?.users.find((x) => x.id === id);
    return u?.full_name || u?.email || id.slice(0, 8);
  };
  const achieved = (t: Target) =>
    (data?.paid ?? [])
      .filter((p) => p.created_by === t.rep_user_id && p.invoice_date && p.invoice_date >= t.period_start && p.invoice_date <= t.period_end)
      .reduce((s, p) => s + p.amount_minor, 0);

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="Sales" title="Sales targets" subtitle="Monthly & quarterly goals vs. paid revenue." icon={TargetIcon}
        actions={canManage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Set target</Button>}
      />
      <div className="space-y-3">
        {(data?.targets ?? []).map((t) => {
          const got = achieved(t);
          const pct = t.target_minor ? Math.min(100, Math.round((got / t.target_minor) * 100)) : 0;
          return (
            <Card key={t.id}>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{userName(t.rep_user_id)}</p>
                  <p className="text-xs text-muted-foreground capitalize">{t.period_type} · {formatDate(t.period_start)} – {formatDate(t.period_end)}</p>
                </div>
                <p className="text-sm font-semibold">{formatMoney(got, t.currency_code)} <span className="text-muted-foreground font-normal">/ {formatMoney(t.target_minor, t.currency_code)}</span></p>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-right text-xs text-muted-foreground">{pct}%</p>
            </Card>
          );
        })}
        {(data?.targets ?? []).length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No targets set yet.</p>}
      </div>

      {open && <SetTarget users={data?.users ?? []} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </div>
  );
}

function SetTarget({ users, onClose, onDone }: { users: User[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ rep: "", period_type: "monthly", start: "", end: "", target: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.rep || !form.start || !form.end) return alert("Rep, start and end are required");
    setBusy(true);
    const { error } = await supabase.from("sales_targets").insert({
      rep_user_id: form.rep, period_type: form.period_type,
      period_start: form.start, period_end: form.end,
      target_minor: Math.round(Number(form.target || 0) * 100),
    });
    setBusy(false);
    if (error) return alert(error.message);
    onDone();
  }

  return (
    <Modal open title="Set sales target" onClose={onClose}>
      <div className="space-y-3">
        <div><Label required>Sales rep</Label>
          <Select value={form.rep} onChange={(e) => set("rep", e.target.value)}>
            <option value="">— choose —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </Select>
        </div>
        <div><Label>Period</Label>
          <Select value={form.period_type} onChange={(e) => set("period_type", e.target.value)}>
            <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label required>Start</Label><Input type="date" value={form.start} onChange={(e) => set("start", e.target.value)} /></div>
          <div><Label required>End</Label><Input type="date" value={form.end} onChange={(e) => set("end", e.target.value)} /></div>
        </div>
        <div><Label>Target (KES)</Label><Input type="number" value={form.target} onChange={(e) => set("target", e.target.value)} /></div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save target"}</Button>
        </div>
      </div>
    </Modal>
  );
}
