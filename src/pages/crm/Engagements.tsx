import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Select, Textarea, Badge, PageHeader, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatDate } from "@/lib/utils";

const PRIORITY_TONE: Record<string, "red" | "amber" | "blue" | "zinc"> = { critical: "red", high: "amber", medium: "blue", low: "zinc" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const blank = { title: "", partner_party_id: "", view: "upstream", stage: "", priority: "medium", next_action: "", due_by: "", note: "" };

export default function Engagements() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, reload } = useData(async () => {
    const [{ data: engagements }, { data: partners }] = await Promise.all([
      supabase.from("engagements")
        .select("id, code, title, stage, priority, next_action, due_by, view, parties:partner_party_id(display_name)")
        .is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("parties").select("id, display_name").eq("type", "partner").is("deleted_at", null).order("display_name"),
    ]);
    return { engagements: (engagements ?? []) as Row[], partners: (partners ?? []) as Row[] };
  }, []);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!can(user, "crm.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to the CRM.</p>;

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { data: created, error } = await supabase.from("engagements").insert({
      title: form.title || null,
      partner_party_id: form.partner_party_id,
      view: form.view,
      stage: form.stage || null,
      priority: form.priority || null,
      next_action: form.next_action || null,
      due_by: form.due_by || null,
    }).select("id").single();
    if (error) { setBusy(false); setErr(error.message); return; }
    // The first "how it went" note becomes the opening timeline entry.
    if (created && form.note.trim()) {
      await supabase.from("engagement_updates").insert({ engagement_id: created.id, summary: form.note.trim() });
    }
    setBusy(false); setOpen(false); setForm({ ...blank });
    if (created) navigate(`/crm/engagements/${created.id}`);
    else reload();
  }

  const rows = data?.engagements ?? [];

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="CRM"
        title="Engagements"
        subtitle="Every partner relationship — log how meetings went and the next step."
        actions={can(user, "crm.create") && <Button onClick={() => { setErr(null); setForm({ ...blank }); setOpen(true); }}><Plus className="h-4 w-4" /> Add engagement</Button>}
      />

      <Table>
        <THead>
          <TH>Name</TH><TH>Partner</TH><TH>Stage</TH><TH>Priority</TH><TH>Next action</TH><TH>Due</TH>
        </THead>
        <TBody>
          {rows.map((e) => (
            <TR key={e.id} className="cursor-pointer" onClick={() => navigate(`/crm/engagements/${e.id}`)}>
              <TD className="font-medium text-foreground">{e.title || e.code || "—"}</TD>
              <TD>{e.parties?.display_name ?? "—"}</TD>
              <TD>{e.stage ? <Badge>{e.stage}</Badge> : "—"}</TD>
              <TD>{e.priority ? <Badge tone={PRIORITY_TONE[e.priority] ?? "zinc"}>{e.priority}</Badge> : "—"}</TD>
              <TD>{e.next_action ?? "—"}</TD>
              <TD>{e.due_by ? formatDate(e.due_by) : "—"}</TD>
            </TR>
          ))}
          {!loading && rows.length === 0 && (
            <TR><TD className="py-10 text-center" colSpan={6}>No engagements yet.</TD></TR>
          )}
        </TBody>
      </Table>

      <Modal open={open} title="Add engagement" onClose={() => setOpen(false)}>
        <form onSubmit={create} className="space-y-4">
          <div><Label>Engagement name</Label><Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. KCB green-energy facility" /></div>
          <div>
            <Label required>Partner</Label>
            <Select value={form.partner_party_id} onChange={(e) => set("partner_party_id", e.target.value)} required>
              <option value="">Select a partner…</option>
              {(data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>View</Label><Select value={form.view} onChange={(e) => set("view", e.target.value)}><option value="upstream">Upstream</option><option value="downstream">Downstream</option></Select></div>
            <div><Label>Priority</Label><Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>{["low", "medium", "high", "critical"].map((p) => <option key={p} value={p}>{p}</option>)}</Select></div>
          </div>
          <div><Label>Stage</Label><Input value={form.stage} onChange={(e) => set("stage", e.target.value)} placeholder="e.g. discovery, negotiation…" /></div>
          <div><Label>How it went (key points)</Label><Textarea rows={4} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="What was discussed, outcomes, anything important…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Next action</Label><Input value={form.next_action} onChange={(e) => set("next_action", e.target.value)} placeholder="e.g. Follow up on term sheet" /></div>
            <div><Label>Next date</Label><Input type="date" value={form.due_by} onChange={(e) => set("due_by", e.target.value)} /></div>
          </div>
          {err && <p className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">{err}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy || !form.partner_party_id}>{busy ? "Saving…" : "Add engagement"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
