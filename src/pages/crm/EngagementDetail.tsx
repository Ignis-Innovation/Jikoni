import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, MessageSquarePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Select, Textarea, Badge, Card, PageHeader } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatDate } from "@/lib/utils";

const PRIORITY_TONE: Record<string, "red" | "amber" | "blue" | "zinc"> = { critical: "red", high: "amber", medium: "blue", low: "zinc" };
const CHANNELS = ["Meeting", "Call", "Email", "WhatsApp", "Site visit", "Note", "Other"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canEdit = can(user, "crm.edit");

  const { data, loading, reload } = useData(async () => {
    const [{ data: eng }, { data: updates }] = await Promise.all([
      supabase.from("engagements")
        .select("id, code, title, stage, priority, status, next_action, due_by, view, partner_party_id, parties:partner_party_id(display_name)")
        .eq("id", id).single(),
      supabase.from("engagement_updates").select("id, update_date, channel, summary")
        .eq("engagement_id", id).is("deleted_at", null)
        .order("update_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    return { eng: eng as Any, updates: (updates ?? []) as Any[] };
  }, [id]);

  // Editable header fields, hydrated once the engagement loads.
  const [hdr, setHdr] = useState({ stage: "", priority: "", status: "", next_action: "", due_by: "" });
  useEffect(() => {
    if (data?.eng) setHdr({
      stage: data.eng.stage ?? "", priority: data.eng.priority ?? "", status: data.eng.status ?? "",
      next_action: data.eng.next_action ?? "", due_by: data.eng.due_by ?? "",
    });
  }, [data?.eng]);

  // Log-update form.
  const [u, setU] = useState({ date: todayIso(), channel: "Meeting", summary: "", next_action: "", due_by: "" });
  const [savingU, setSavingU] = useState(false);
  const [savingHdr, setSavingHdr] = useState(false);

  // New-opportunity modal.
  const [oppOpen, setOppOpen] = useState(false);
  const [opp, setOpp] = useState({ title: "", type: "", deadline: "", status: "open" });
  const [savingOpp, setSavingOpp] = useState(false);

  if (!can(user, "crm.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to the CRM.</p>;
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data?.eng) return <p className="text-sm text-muted-foreground">Engagement not found.</p>;
  const eng = data.eng;

  async function saveHeader() {
    setSavingHdr(true);
    await supabase.from("engagements").update({
      stage: hdr.stage || null, priority: hdr.priority || null, status: hdr.status || null,
      next_action: hdr.next_action || null, due_by: hdr.due_by || null,
    }).eq("id", id);
    setSavingHdr(false);
    reload();
  }

  async function logUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!u.summary.trim()) return;
    setSavingU(true);
    await supabase.from("engagement_updates").insert({
      engagement_id: id, update_date: u.date || todayIso(), channel: u.channel, summary: u.summary.trim(),
    });
    // Optionally roll the engagement's next action / next date forward (the follow-up).
    if (u.next_action || u.due_by) {
      await supabase.from("engagements").update({
        next_action: u.next_action || eng.next_action, due_by: u.due_by || eng.due_by,
      }).eq("id", id);
    }
    setSavingU(false);
    setU({ date: todayIso(), channel: "Meeting", summary: "", next_action: "", due_by: "" });
    reload();
  }

  async function createOpp(e: React.FormEvent) {
    e.preventDefault();
    setSavingOpp(true);
    await supabase.from("opportunities").insert({
      title: opp.title || `${eng.parties?.display_name ?? "Partner"} opportunity`,
      funder_party_id: eng.partner_party_id, type: opp.type || null,
      deadline: opp.deadline || null, status: opp.status,
    });
    setSavingOpp(false); setOppOpen(false); setOpp({ title: "", type: "", deadline: "", status: "open" });
  }

  return (
    <div className="w-full">
      <Link to="/crm/engagements" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Engagements
      </Link>
      <PageHeader
        eyebrow={eng.parties?.display_name ?? "Partner"}
        title={eng.title || eng.code || "Engagement"}
        subtitle={eng.code ? `${eng.code} · ${eng.view ?? ""}` : undefined}
        actions={can(user, "crm.create") && <Button variant="outline" onClick={() => setOppOpen(true)}><Plus className="h-4 w-4" /> New opportunity</Button>}
      />

      {/* Status / next action — the scheduled follow-up lives here. */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Stage</Label><Input value={hdr.stage} disabled={!canEdit} onChange={(e) => setHdr({ ...hdr, stage: e.target.value })} /></div>
          <div><Label>Priority</Label><Select value={hdr.priority} disabled={!canEdit} onChange={(e) => setHdr({ ...hdr, priority: e.target.value })}><option value="">—</option>{["low", "medium", "high", "critical"].map((p) => <option key={p} value={p}>{p}</option>)}</Select></div>
          <div><Label>Next action</Label><Input value={hdr.next_action} disabled={!canEdit} onChange={(e) => setHdr({ ...hdr, next_action: e.target.value })} placeholder="e.g. Follow-up call next week" /></div>
          <div><Label>Next date</Label><Input type="date" value={hdr.due_by} disabled={!canEdit} onChange={(e) => setHdr({ ...hdr, due_by: e.target.value })} /></div>
        </div>
        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={saveHeader} disabled={savingHdr}>{savingHdr ? "Saving…" : "Save"}</Button>
          </div>
        )}
      </Card>

      {/* Log a meeting / follow-up. */}
      {can(user, "crm.create") && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><MessageSquarePlus className="h-4 w-4" /> Log update / follow-up</h2>
          <form onSubmit={logUpdate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={u.date} onChange={(e) => setU({ ...u, date: e.target.value })} /></div>
              <div><Label>Channel</Label><Select value={u.channel} onChange={(e) => setU({ ...u, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>
            </div>
            <div><Label required>How it went</Label><Textarea rows={3} value={u.summary} onChange={(e) => setU({ ...u, summary: e.target.value })} placeholder="What was discussed / agreed…" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Set next action</Label><Input value={u.next_action} onChange={(e) => setU({ ...u, next_action: e.target.value })} placeholder="optional" /></div>
              <div><Label>Set next date</Label><Input type="date" value={u.due_by} onChange={(e) => setU({ ...u, due_by: e.target.value })} /></div>
            </div>
            <div className="flex justify-end"><Button type="submit" size="sm" disabled={savingU || !u.summary.trim()}>{savingU ? "Saving…" : "Add to timeline"}</Button></div>
          </form>
        </Card>
      )}

      {/* Timeline. */}
      <h2 className="mb-2 text-sm font-semibold text-foreground">Activity timeline</h2>
      <div className="space-y-2">
        {data.updates.length === 0 && <p className="text-sm text-muted-foreground">No updates logged yet.</p>}
        {data.updates.map((up) => (
          <Card key={up.id} className="p-3.5">
            <div className="mb-1 flex items-center gap-2">
              {up.channel && <Badge tone="blue">{up.channel}</Badge>}
              <span className="text-xs text-muted-foreground">{up.update_date ? formatDate(up.update_date) : ""}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{up.summary}</p>
          </Card>
        ))}
      </div>

      <Modal open={oppOpen} title="New opportunity" onClose={() => setOppOpen(false)}>
        <form onSubmit={createOpp} className="space-y-4">
          <p className="text-xs text-muted-foreground">Funder: <span className="font-medium text-foreground">{eng.parties?.display_name ?? "—"}</span></p>
          <div><Label required>Title</Label><Input value={opp.title} onChange={(e) => setOpp({ ...opp, title: e.target.value })} required placeholder="e.g. Climate finance window 2026" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label><Input value={opp.type} onChange={(e) => setOpp({ ...opp, type: e.target.value })} placeholder="RFP, grant…" /></div>
            <div><Label>Deadline</Label><Input type="date" value={opp.deadline} onChange={(e) => setOpp({ ...opp, deadline: e.target.value })} /></div>
          </div>
          <div><Label>Status</Label><Select value={opp.status} onChange={(e) => setOpp({ ...opp, status: e.target.value })}>{["open", "pursuing", "submitted", "won", "lost", "closed"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={savingOpp || !opp.title}>{savingOpp ? "Saving…" : "Create opportunity"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOppOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
