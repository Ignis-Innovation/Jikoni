import { useState } from "react";
import { UserPlus, Send, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Select, Textarea, Badge, Card, PageHeader, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

const STATUS_TONE: Record<string, "green" | "amber" | "blue" | "zinc"> = { done: "green", in_progress: "blue", pending: "amber" };
const PRIORITY_TONE: Record<string, "red" | "amber" | "zinc"> = { high: "red", medium: "amber", low: "zinc" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const blank = { title: "", description: "", priority: "medium", due_date: "" };

export default function AssignTask() {
  const { user } = useAuth();
  const canAssign = can(user, "people.edit");

  const { data, loading, reload } = useData(async () => {
    const [{ data: members }, { data: assigned }] = await Promise.all([
      // Team members the manager can pick from (exclude self — you assign to others).
      supabase.from("users").select("id, full_name, email").is("deleted_at", null).order("full_name"),
      // Tasks this manager has already assigned, newest first.
      supabase.from("tasks")
        .select("id, title, status, priority, due_date, created_at, assignee_id, assignee:assignee_id(full_name, email)")
        .eq("assigned_by", user?.id ?? "")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ]);
    return {
      members: ((members ?? []) as Any[]).filter((m) => m.id !== user?.id),
      assigned: (assigned ?? []) as Any[],
    };
  }, [user?.id]);

  const [form, setForm] = useState({ ...blank });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const members = data?.members ?? [];
  const assigned = data?.assigned ?? [];
  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (!can(user, "people.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to task assignment.</p>;

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || selected.size === 0) return;
    setBusy(true);
    setDone(null);
    // One task row per assignee. assigned_by = the manager so the assignee's
    // Tasks board shows "assigned by …", and the send-task-assignments script
    // (notified_at is null until it mails them) can pick the row up.
    const rows = [...selected].map((assignee_id) => ({
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      due_date: form.due_date || null,
      assignee_id,
      assigned_by: user?.id,
    }));
    const { error } = await supabase.from("tasks").insert(rows);
    setBusy(false);
    if (error) {
      setDone(`Could not assign: ${error.message}`);
      return;
    }
    const names = members.filter((m) => selected.has(m.id)).map((m) => m.full_name ?? m.email);
    setDone(`Assigned to ${names.join(", ")}. They'll be emailed and the task is now on their board.`);
    setForm({ ...blank });
    setSelected(new Set());
    reload();
  }

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="People Ops"
        icon={UserPlus}
        title="Assign Task"
        subtitle="Assign a task to one or more team members. They're emailed a link and see it on their Tasks board."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- Assignment form ---- */}
        <Card>
          <form onSubmit={assign} className="space-y-4">
            <div>
              <Label required>Task name</Label>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} required placeholder="e.g. Prepare partner report" disabled={!canAssign} />
            </div>
            <div>
              <Label>Task description</Label>
              <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What needs to be done?" disabled={!canAssign} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onChange={(e) => set("priority", e.target.value)} disabled={!canAssign}>
                  {["low", "medium", "high"].map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div>
                <Label>Timeline (due date)</Label>
                <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} disabled={!canAssign} />
              </div>
            </div>

            <div>
              <Label>Assign team members <span className="font-normal text-muted-foreground">(select one or more)</span></Label>
              <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
                {members.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">{loading ? "Loading team…" : "No team members found."}</p>}
                {members.map((m) => {
                  const on = selected.has(m.id);
                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => canAssign && toggle(m.id)}
                      disabled={!canAssign}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                        on ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{m.full_name ?? m.email}</span>
                        {m.full_name && <span className="block truncate text-xs text-muted-foreground">{m.email}</span>}
                      </span>
                      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selected.size > 0 && <p className="mt-1 text-xs text-muted-foreground">{selected.size} member{selected.size > 1 ? "s" : ""} selected</p>}
            </div>

            {done && <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">{done}</p>}

            <Button type="submit" disabled={!canAssign || busy || !form.title.trim() || selected.size === 0}>
              <Send className="h-4 w-4" /> {busy ? "Assigning…" : "Assign task"}
            </Button>
            {!canAssign && <p className="text-xs text-muted-foreground">You need People (HR) edit access to assign tasks.</p>}
          </form>
        </Card>

        {/* ---- Tasks I've assigned ---- */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Tasks you&apos;ve assigned</h2>
          <Table>
            <THead>
              <TH>Task</TH><TH>Assignee</TH><TH>Due</TH><TH>Priority</TH><TH>Status</TH>
            </THead>
            <TBody>
              {assigned.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium text-foreground">{t.title}</TD>
                  <TD>{t.assignee?.full_name ?? t.assignee?.email ?? "—"}</TD>
                  <TD>{t.due_date ? formatDate(t.due_date) : "—"}</TD>
                  <TD>{t.priority ? <Badge tone={PRIORITY_TONE[t.priority] ?? "zinc"}>{t.priority}</Badge> : "—"}</TD>
                  <TD><Badge tone={STATUS_TONE[t.status] ?? "zinc"}>{t.status.replace("_", " ")}</Badge></TD>
                </TR>
              ))}
              {!loading && assigned.length === 0 && (
                <TR><TD className="py-10 text-center" colSpan={5}>You haven&apos;t assigned any tasks yet.</TD></TR>
              )}
            </TBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
