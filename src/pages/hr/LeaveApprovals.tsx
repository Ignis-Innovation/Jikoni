import { useState } from "react";
import { Check, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Badge, PageHeader, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "zinc"> = { approved: "green", pending: "amber", rejected: "red", cancelled: "zinc" };
type Filter = "pending" | "all";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function LeaveApprovals() {
  const { user } = useAuth();
  // Default to "all": approving/rejecting changes a row's status but never
  // removes it, so the full leave history (a useful record) stays on screen.
  const [filter, setFilter] = useState<Filter>("all");
  const canApprove = can(user, "people.edit");

  const { data, loading, reload } = useData(async () => {
    let q = supabase.from("leave_applications")
      .select("id, start_date, end_date, days, status, created_at, user_id, leave_types:type_id(name), users:user_id(full_name, email)")
      .is("deleted_at", null);
    if (filter === "pending") q = q.eq("status", "pending");
    const { data: apps } = await q.order("created_at", { ascending: false });
    return (apps ?? []) as Any[];
  }, [filter]);

  if (!can(user, "people.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to leave approvals.</p>;

  async function decide(id: string, status: "approved" | "rejected") {
    // Persist the decision. The record stays in the list with its new status
    // badge so the approval/rejection history remains visible.
    await supabase.from("leave_applications").update({ status }).eq("id", id);
    reload();
  }

  // Pending applications float to the top so they're actioned first, while
  // already-decided ones remain below as a saved record.
  const apps = [...(data ?? [])].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return 0;
  });

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="People Ops"
        title="Leave Approvals"
        subtitle="Review and approve staff leave applications."
        actions={
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {(["pending", "all"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn("rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                  filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {f}
              </button>
            ))}
          </div>
        }
      />

      <Table>
        <THead>
          <TH>Employee</TH><TH>Type</TH><TH>From</TH><TH>To</TH><TH>Days</TH><TH>Status</TH><TH></TH>
        </THead>
        <TBody>
          {apps.map((a) => (
            <TR key={a.id}>
              <TD className="font-medium text-foreground">{a.users?.full_name ?? a.users?.email ?? "—"}</TD>
              <TD>{a.leave_types?.name ?? "—"}</TD>
              <TD>{a.start_date ? formatDate(a.start_date) : "—"}</TD>
              <TD>{a.end_date ? formatDate(a.end_date) : "—"}</TD>
              <TD>{a.days ?? "—"}</TD>
              <TD><Badge tone={STATUS_TONE[a.status] ?? "zinc"}>{a.status}</Badge></TD>
              <TD className="text-right">
                {a.status === "pending" && canApprove && (
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" onClick={() => decide(a.id, "approved")}><Check className="h-3.5 w-3.5" /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => decide(a.id, "rejected")}><X className="h-3.5 w-3.5" /> Reject</Button>
                  </div>
                )}
              </TD>
            </TR>
          ))}
          {!loading && apps.length === 0 && (
            <TR><TD className="py-10 text-center" colSpan={7}>{filter === "pending" ? "No pending applications." : "No applications."}</TD></TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
