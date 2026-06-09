import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge, PageHeader, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { cn, formatDate } from "@/lib/utils";

type View = "upstream" | "downstream" | "opportunities";

// Engagement stage sets per view; anything off-list lands in "Other".
const STAGES: Record<"upstream" | "downstream", string[]> = {
  upstream: ["discovery", "materials", "negotiation", "term_sheet", "drawdown"],
  downstream: ["identification", "EOI", "site_visit", "contracting", "deployment"],
};
// Opportunity lifecycle columns.
const OPP_STATUSES = ["open", "pursuing", "submitted", "won", "lost", "closed"];

const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery", materials: "Materials", negotiation: "Negotiation", term_sheet: "Term sheet", drawdown: "Drawdown",
  identification: "Identification", EOI: "EOI", site_visit: "Site visit", contracting: "Contracting", deployment: "Deployment",
  other: "Other",
  open: "Open", pursuing: "Pursuing", submitted: "Submitted", won: "Won", lost: "Lost", closed: "Closed",
};
const COL_ACCENT: Record<string, string> = {
  discovery: "bg-sky-400", materials: "bg-indigo-400", negotiation: "bg-violet-400", term_sheet: "bg-amber-400", drawdown: "bg-emerald-500",
  identification: "bg-sky-400", EOI: "bg-indigo-400", site_visit: "bg-violet-400", contracting: "bg-amber-400", deployment: "bg-emerald-500",
  open: "bg-sky-400", pursuing: "bg-violet-400", submitted: "bg-amber-400", won: "bg-emerald-500", lost: "bg-red-400", closed: "bg-zinc-300",
  other: "bg-zinc-300",
};
const PRIORITY_TONE: Record<string, "red" | "amber" | "blue" | "zinc"> = { critical: "red", high: "amber", medium: "blue", low: "zinc" };
const OPP_TONE: Record<string, "blue" | "amber" | "green" | "red" | "zinc"> = { open: "blue", pursuing: "amber", submitted: "blue", won: "green", lost: "red", closed: "zinc" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function CrmPipeline() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("upstream");
  const [opp, setOpp] = useState<Any | null>(null); // opportunity detail modal

  const { data, loading } = useData(async () => {
    if (view === "opportunities") {
      const { data: opps } = await supabase
        .from("opportunities")
        .select("id, title, type, deadline, status, source_url, parties:funder_party_id(display_name)")
        .is("deleted_at", null)
        .order("deadline", { ascending: true });
      return (opps ?? []) as Any[];
    }
    const { data: engs } = await supabase
      .from("engagements")
      .select("id, code, title, stage, priority, next_action, due_by, view, parties:partner_party_id(display_name)")
      .eq("view", view)
      .is("deleted_at", null)
      .order("due_by", { ascending: true });
    return (engs ?? []) as Any[];
  }, [view]);

  if (!can(user, "crm.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to the CRM.</p>;

  const rows = data ?? [];
  const isOpp = view === "opportunities";
  const columns = isOpp ? OPP_STATUSES : [...STAGES[view], "other"];

  const inColumn = (col: string) =>
    rows.filter((r) => {
      if (isOpp) return (r.status ?? "open").toLowerCase() === col;
      const s = (r.stage ?? "").toLowerCase();
      if (col === "other") return !STAGES[view as "upstream" | "downstream"].map((x) => x.toLowerCase()).includes(s);
      return s === col.toLowerCase();
    });

  const overdue = (d: string | null) => d && new Date(d).getTime() < Date.now();

  // Small type tag shown at the top of every card.
  const TypeTag = ({ kind }: { kind: "engagement" | "opportunity" }) => (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
      kind === "engagement" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700")}>
      {kind}
    </span>
  );

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        eyebrow="CRM"
        title="Pipeline"
        subtitle={`${rows.length} ${isOpp ? "opportunit" + (rows.length === 1 ? "y" : "ies") : "engagement" + (rows.length === 1 ? "" : "s")} · ${isOpp ? "by status" : "by stage"}`}
        actions={
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {(["upstream", "downstream", "opportunities"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={cn("rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {v}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid auto-cols-fr grid-flow-col gap-3 overflow-x-auto pb-4">
        {columns.map((col) => {
          const items = inColumn(col);
          if (col === "other" && items.length === 0) return null;
          return (
            <div key={col} className="flex min-w-[260px] flex-col overflow-hidden rounded-xl border border-border bg-card">
              <div className={cn("h-1 w-full", COL_ACCENT[col] ?? "bg-zinc-300")} />
              <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
                <span className="text-sm font-semibold text-foreground">{STAGE_LABEL[col] ?? col}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5 bg-muted/30 p-2.5">
                {loading ? (
                  <div className="h-24 animate-pulse rounded-lg bg-card" />
                ) : items.length === 0 ? (
                  <p className="px-1 py-8 text-center text-xs text-muted-foreground">—</p>
                ) : isOpp ? (
                  items.map((o) => (
                    <button key={o.id} onClick={() => setOpp(o)}
                      className="rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <TypeTag kind="opportunity" />
                      <p className="mt-1.5 text-sm font-semibold leading-tight text-foreground">{o.title}</p>
                      {o.parties?.display_name && <p className="mt-0.5 text-xs text-muted-foreground">Funder: {o.parties.display_name}</p>}
                      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
                        <span className="text-[11px] text-muted-foreground">{o.type || ""}</span>
                        {o.deadline && (
                          <span className={cn("text-[11px] font-medium", overdue(o.deadline) ? "text-destructive" : "text-muted-foreground")}>
                            {overdue(o.deadline) ? "passed · " : "due "}{formatDate(o.deadline)}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  items.map((e) => (
                    <button key={e.id} onClick={() => navigate(`/crm/engagements/${e.id}`)}
                      className="rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex items-center justify-between gap-2">
                        <TypeTag kind="engagement" />
                        {e.priority && <Badge tone={PRIORITY_TONE[e.priority] ?? "zinc"}>{e.priority}</Badge>}
                      </div>
                      <p className="mt-1.5 text-sm font-semibold leading-tight text-foreground">{e.parties?.display_name ?? "—"}</p>
                      {e.title && <p className="mt-0.5 text-xs text-muted-foreground">{e.title}</p>}
                      {e.next_action && (
                        <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-foreground"><span className="font-medium">Next:</span> {e.next_action}</p>
                      )}
                      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
                        <span className="font-mono text-[10px] text-muted-foreground">{e.code ?? ""}</span>
                        {e.due_by && (
                          <span className={cn("text-[11px] font-medium", overdue(e.due_by) ? "text-destructive" : "text-muted-foreground")}>
                            {overdue(e.due_by) ? "overdue · " : "due "}{formatDate(e.due_by)}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Opportunity detail popup */}
      <Modal open={!!opp} title="Opportunity" onClose={() => setOpp(null)}>
        {opp && (
          <div className="space-y-3">
            <div>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-violet-100 text-violet-700">opportunity</span>
              <h3 className="mt-1.5 text-lg font-semibold text-foreground">{opp.title}</h3>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Funder</dt><dd className="text-foreground">{opp.parties?.display_name ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="text-foreground">{opp.type || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Deadline</dt><dd className="text-foreground">{opp.deadline ? formatDate(opp.deadline) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd><Badge tone={OPP_TONE[opp.status] ?? "zinc"}>{opp.status}</Badge></dd></div>
            </dl>
            {opp.source_url && (
              <a href={opp.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Source link
              </a>
            )}
            <div className="pt-1">
              <Card className="bg-muted/40 p-3 text-xs text-muted-foreground">
                Opportunities are managed under CRM → Opportunities. Created from an engagement, they carry that partner as the funder.
              </Card>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
