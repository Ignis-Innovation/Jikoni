import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

type View = "upstream" | "downstream";

// Stage sets per view (PRD §7B). Anything off-list lands in "Other".
const STAGES: Record<View, string[]> = {
  upstream: ["discovery", "materials", "negotiation", "term_sheet", "drawdown"],
  downstream: ["identification", "EOI", "site_visit", "contracting", "deployment"],
};
const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery", materials: "Materials", negotiation: "Negotiation", term_sheet: "Term sheet", drawdown: "Drawdown",
  identification: "Identification", EOI: "EOI", site_visit: "Site visit", contracting: "Contracting", deployment: "Deployment",
};
const PRIORITY_TONE: Record<string, "red" | "amber" | "blue" | "zinc"> = {
  critical: "red", high: "amber", medium: "blue", low: "zinc",
};

type Eng = {
  id: string; code: string | null; stage: string | null; priority: string | null;
  next_action: string | null; due_by: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parties: any;
};

export default function CrmPipeline() {
  const { user } = useAuth();
  const [view, setView] = useState<View>("upstream");

  const { data: rows, loading } = useData(async () => {
    const { data } = await supabase
      .from("engagements")
      .select("id, code, stage, priority, next_action, due_by, view, parties:partner_party_id(display_name)")
      .eq("view", view)
      .is("deleted_at", null)
      .order("due_by", { ascending: true });
    return (data ?? []) as Eng[];
  }, [view]);

  if (!can(user, "crm.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to the CRM.</p>;

  const columns = [...STAGES[view], "other"];
  const byStage = (stage: string) =>
    (rows ?? []).filter((e) => {
      const s = (e.stage ?? "").toLowerCase();
      if (stage === "other") return !STAGES[view].map((x) => x.toLowerCase()).includes(s);
      return s === stage.toLowerCase();
    });

  const overdue = (d: string | null) => d && new Date(d).getTime() < Date.now();

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow="CRM"
        title="Pipeline"
        subtitle="One engagements model, two views. Cards grouped by stage."
        actions={
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {(["upstream", "downstream"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((stage) => {
          const items = byStage(stage);
          if (stage === "other" && items.length === 0) return null;
          return (
            <div key={stage} className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/40">
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="text-sm font-medium text-foreground">{STAGE_LABEL[stage] ?? "Other"}</span>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {loading ? (
                  <div className="h-20 animate-pulse rounded-lg bg-card" />
                ) : items.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">—</p>
                ) : (
                  items.map((e) => (
                    <div key={e.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-tight text-foreground">{e.parties?.display_name ?? "—"}</p>
                        {e.priority && <Badge tone={PRIORITY_TONE[e.priority] ?? "zinc"}>{e.priority}</Badge>}
                      </div>
                      {e.next_action && <p className="mt-1.5 text-xs text-muted-foreground">{e.next_action}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-muted-foreground">{e.code}</span>
                        {e.due_by && (
                          <span className={cn("text-[11px]", overdue(e.due_by) ? "font-medium text-destructive" : "text-muted-foreground")}>
                            {overdue(e.due_by) ? "overdue · " : "due "}{formatDate(e.due_by)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
