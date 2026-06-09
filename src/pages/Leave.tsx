import { useState } from "react";
import { Plus, CalendarCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Select, Badge, Card, PageHeader, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatDate } from "@/lib/utils";
import { workingDaysBetween } from "@/lib/holidays";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "zinc"> = { approved: "green", pending: "amber", rejected: "red", cancelled: "zinc" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const blank = { type_id: "", start_date: "", end_date: "" };

export default function Leave() {
  const { user } = useAuth();
  const { data, loading, reload } = useData(async () => {
    const [{ data: types }, { data: apps }] = await Promise.all([
      supabase.from("leave_types").select("id, name, annual_days").is("deleted_at", null).order("name"),
      supabase.from("leave_applications")
        .select("id, start_date, end_date, days, status, created_at, type_id, leave_types:type_id(name)")
        .eq("user_id", user?.id).is("deleted_at", null).order("created_at", { ascending: false }),
    ]);
    return { types: (types ?? []) as Any[], apps: (apps ?? []) as Any[] };
  }, [user?.id]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);

  const types = data?.types ?? [];
  const apps = data?.apps ?? [];
  const requestedDays = workingDaysBetween(form.start_date, form.end_date);

  // Balance per leave type: entitled − approved − pending = available.
  const balanceFor = (typeId: string, entitled: number) => {
    const mine = apps.filter((a) => a.type_id === typeId);
    const sum = (s: string) => mine.filter((a) => a.status === s).reduce((n, a) => n + Number(a.days || 0), 0);
    const approved = sum("approved");
    const pending = sum("pending");
    return { entitled, approved, pending, available: entitled - approved - pending };
  };

  // Balance + enforcement for the type chosen in the apply form.
  const selType = types.find((t) => t.id === form.type_id);
  const selBalance = selType ? balanceFor(selType.id, Number(selType.annual_days || 0)) : null;
  const exceedsBalance = selBalance != null && requestedDays > selBalance.available;

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!form.type_id || requestedDays <= 0 || exceedsBalance) return;
    setBusy(true);
    await supabase.from("leave_applications").insert({
      user_id: user?.id,
      type_id: form.type_id,
      start_date: form.start_date,
      end_date: form.end_date,
      days: requestedDays,
      status: "pending",
    });
    setBusy(false); setOpen(false); setForm({ ...blank }); reload();
  }

  async function cancel(id: string) {
    await supabase.from("leave_applications").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    reload();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Workspace"
        icon={CalendarCheck}
        title="Leave Application"
        subtitle="Check your balance and apply for time off. Days exclude weekends & public holidays."
        actions={<Button onClick={() => { setForm({ ...blank }); setOpen(true); }}><Plus className="h-4 w-4" /> Apply for leave</Button>}
      />

      {/* Balance cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {types.map((t) => {
          const b = balanceFor(t.id, Number(t.annual_days || 0));
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-foreground">{t.name}</p>
                <p className="text-2xl font-semibold text-primary">{b.available}</p>
              </div>
              <p className="text-xs text-muted-foreground">days available of {b.entitled}</p>
              <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                <span>Taken {b.approved}</span>
                <span>Pending {b.pending}</span>
              </div>
            </Card>
          );
        })}
        {types.length === 0 && <p className="text-sm text-muted-foreground">No leave types configured.</p>}
      </div>

      {/* My applications */}
      <h2 className="mb-2 text-sm font-semibold text-foreground">My applications</h2>
      <Table>
        <THead>
          <TH>Type</TH><TH>From</TH><TH>To</TH><TH>Days</TH><TH>Status</TH><TH></TH>
        </THead>
        <TBody>
          {apps.map((a) => (
            <TR key={a.id}>
              <TD className="font-medium text-foreground">{a.leave_types?.name ?? "—"}</TD>
              <TD>{a.start_date ? formatDate(a.start_date) : "—"}</TD>
              <TD>{a.end_date ? formatDate(a.end_date) : "—"}</TD>
              <TD>{a.days ?? "—"}</TD>
              <TD><Badge tone={STATUS_TONE[a.status] ?? "zinc"}>{a.status}</Badge></TD>
              <TD className="text-right">
                {a.status === "pending" && <Button size="sm" variant="ghost" onClick={() => cancel(a.id)}>Cancel</Button>}
              </TD>
            </TR>
          ))}
          {!loading && apps.length === 0 && (
            <TR><TD className="py-10 text-center" colSpan={6}>No leave applications yet.</TD></TR>
          )}
        </TBody>
      </Table>

      <Modal open={open} title="Apply for leave" onClose={() => setOpen(false)}>
        <form onSubmit={apply} className="space-y-4">
          <div>
            <Label required>Leave type</Label>
            <Select value={form.type_id} onChange={(e) => set("type_id", e.target.value)} required>
              <option value="">Select…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label required>From</Label><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} required /></div>
            <div><Label required>To</Label><Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} required /></div>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
            Working days requested: <span className="font-semibold">{requestedDays}</span>
            <span className="text-xs text-muted-foreground"> (excl. weekends & holidays)</span>
            {selBalance != null && (
              <span className="ml-2 text-xs text-muted-foreground">· {selBalance.available} available</span>
            )}
          </div>
          {exceedsBalance && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              {selBalance && selBalance.available <= 0
                ? "You have no leave days left for this type — you can't apply."
                : `Not enough balance: ${requestedDays} requested but only ${selBalance?.available} available.`}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy || !form.type_id || requestedDays <= 0 || exceedsBalance}>{busy ? "Submitting…" : "Submit application"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
