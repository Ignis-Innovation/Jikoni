import { useState } from "react";
import { Plus, Trash2, Check, ListTodo } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Select, Textarea, Badge, PageHeader } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { cn, formatDate } from "@/lib/utils";

type Status = "pending" | "in_progress" | "done";
const COLUMNS: { key: Status; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Complete" },
];
const PRIORITY_TONE: Record<string, "red" | "amber" | "blue" | "zinc"> = { high: "red", medium: "amber", low: "zinc" };
const NEXT: Record<Status, Status | null> = { pending: "in_progress", in_progress: "done", done: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Task = any;
const blank = { title: "", description: "", priority: "medium", due_date: "" };

export default function Tasks() {
  const { user } = useAuth();
  const { data, loading, reload } = useData(async () => {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title, description, status, priority, due_date, created_at, assignee_id, assigned_by, assigner:assigned_by(full_name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    return (tasks ?? []) as Task[];
  }, []);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);

  const tasks = data ?? [];
  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    await supabase.from("tasks").insert({
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      due_date: form.due_date || null,
      assignee_id: user?.id, // self-assigned
    });
    setBusy(false); setOpen(false); setForm({ ...blank }); reload();
  }

  async function move(t: Task) {
    const to = NEXT[t.status as Status];
    if (!to) return;
    await supabase.from("tasks").update({ status: to }).eq("id", t.id);
    reload();
  }
  async function setStatus(t: Task, status: Status) {
    await supabase.from("tasks").update({ status }).eq("id", t.id);
    reload();
  }
  async function remove(t: Task) {
    await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", t.id);
    reload();
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow="Workspace"
        icon={ListTodo}
        title="Tasks"
        subtitle="Your to-dos and tasks assigned to you. Move them across the board."
        actions={<Button onClick={() => { setForm({ ...blank }); setOpen(true); }}><Plus className="h-4 w-4" /> Add task</Button>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="flex flex-col rounded-xl border border-border bg-muted/40">
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="text-sm font-medium text-foreground">{col.label}</span>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {loading ? (
                  <div className="h-20 animate-pulse rounded-lg bg-card" />
                ) : items.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">—</p>
                ) : (
                  items.map((t) => (
                    <div key={t.id} className="group rounded-lg border border-border bg-card p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-sm font-medium leading-tight text-foreground", t.status === "done" && "line-through opacity-60")}>{t.title}</p>
                        {t.priority && <Badge tone={PRIORITY_TONE[t.priority] ?? "zinc"}>{t.priority}</Badge>}
                      </div>
                      {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                      {t.assigned_by && t.assigned_by !== user?.id && (
                        <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          assigned by {t.assigner?.full_name ?? "your manager"}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">{t.due_date ? `due ${formatDate(t.due_date)}` : ""}</span>
                        <div className="flex items-center gap-1">
                          {t.status !== "done" && (
                            <button onClick={() => move(t)} title="Advance" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <Select value={t.status} onChange={(e) => setStatus(t, e.target.value as Status)} className="h-7 w-auto px-1.5 text-xs">
                            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </Select>
                          <button onClick={() => remove(t)} title="Delete" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={open} title="Add task" onClose={() => setOpen(false)}>
        <form onSubmit={create} className="space-y-4">
          <div><Label required>Title</Label><Input value={form.title} onChange={(e) => set("title", e.target.value)} required placeholder="e.g. Prepare partner deck" /></div>
          <div><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Priority</Label><Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>{["low", "medium", "high"].map((p) => <option key={p} value={p}>{p}</option>)}</Select></div>
            <div><Label>Due date</Label><Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy || !form.title.trim()}>{busy ? "Adding…" : "Add task"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
