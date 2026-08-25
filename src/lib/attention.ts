// Shared "needs attention" + project-health logic, reused by the Home dashboard
// action feed and the Projects Overview. Pure functions over store slices — no
// React, no data fetching — so both views agree on what's urgent and how a
// project's health is scored.
import type { ProjectDetail, WeekTask } from "../data";

/* ----- project money + health (shared with Projects.tsx) ----- */
export const budgetOf = (p: ProjectDetail) => p.budgetAmount ?? 0;
export const spentOf = (p: ProjectDetail) => p.spentAmount ?? 0;
export const burnOf = (p: ProjectDetail) => {
  const b = budgetOf(p);
  return b > 0 ? Math.round((spentOf(p) / b) * 100) : 0;
};
// milestone completion %, falling back to burn when a project has no milestones
export const progressOf = (p: ProjectDetail) => {
  const ms = p.milestones ?? [];
  if (ms.length) return Math.round((ms.filter((m) => m.s === "done").length / ms.length) * 100);
  return burnOf(p);
};

const DAY = 86_400_000;
const daysAway = (iso?: string | null) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.round((t - Date.now()) / DAY);
};
// a project the review would call "stale" — nothing changed in a while
const STALE_DAYS = 21;

// A milestone is "behind" when it's not done and its end date has passed.
const behindMilestones = (p: ProjectDetail) =>
  (p.milestones ?? []).filter((m) => m.s !== "done" && (daysAway(m.end) ?? 1) < 0);

export type Health = "green" | "amber" | "red";
export interface ProjectHealth { level: Health; label: string; color: string; dot: string }

// Red = at risk (over-burnt or overdue reporting), amber = needs attention
// (milestones behind, budget getting tight, or gone stale), green = on track.
export function projectHealth(p: ProjectDetail): ProjectHealth {
  const burn = burnOf(p);
  const reportOverdue = /overdue|due|jul/i.test(p.reporting || "");
  const stale = (daysAway(p.updatedAt) ?? 0) < -STALE_DAYS;
  if (burn >= 100 || (burn >= 80 && behindMilestones(p).length > 0))
    return { level: "red", label: "At risk", color: "var(--red)", dot: "🔴" };
  if (burn >= 80 || behindMilestones(p).length > 0 || reportOverdue || stale)
    return { level: "amber", label: "Needs attention", color: "var(--ember)", dot: "🟡" };
  return { level: "green", label: "On track", color: "var(--green)", dot: "🟢" };
}

/* ----- the action feed ----- */
export interface AttentionItem {
  key: string;                                   // stable React key
  cat: "approval" | "report" | "milestone" | "task" | "budget" | "stale";
  code: string;                                  // short badge text
  codeColor: string;                             // css var for the badge
  title: string;
  sub: string;
  pill: { cls: string; txt: string };
  view: string;                                  // navigation target
  tab?: string;
}

// Minimal shape of an AP invoice this selector needs (structural — avoids a
// store import cycle). ApInvoice in store.tsx is a superset.
export interface ApLite { ref: string; vendor: string; amount: number; state: string; capturedByMe?: boolean }

export interface AttentionInput {
  projectDetails: Record<string, ProjectDetail>;
  apInvoices: ApLite[];
  myWeek: WeekTask[];
  meEmail?: string | null;
}

const kesShort = (n: number) => (n >= 1e6 ? `KES ${(n / 1e6).toFixed(1)}M` : `KES ${Math.round(n).toLocaleString()}`);

// Build the flat list of things that need attention, most-urgent-ish first
// within each category. Home groups/orders these; Projects reuses the pieces.
export function buildAttention({ projectDetails, apInvoices, myWeek, meEmail }: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const projects = Object.entries(projectDetails).map(([name, d]) => ({ name, ...d }));

  // 1. Pending approvals (invoices matched/approved and not captured by me)
  for (const i of apInvoices) {
    if (i.state === "matched" || i.state === "approved") {
      items.push({
        key: "ap-" + i.ref, cat: "approval", code: "AP", codeColor: "var(--green)",
        title: `${i.vendor} — ${kesShort(i.amount)}`,
        sub: i.state === "approved" ? "approved · ready to pay" : i.capturedByMe ? "matched · you captured" : "matched · awaiting approval",
        pill: { cls: i.state === "approved" ? "done" : "today", txt: i.state === "approved" ? "Pay" : "Approve" },
        view: "finance", tab: "f-ap",
      });
    }
  }

  // 2. Reports due to funders
  for (const p of projects) {
    if (p.reporting && !/to be set/i.test(p.reporting) && /overdue|due|jul|next/i.test(p.reporting)) {
      const over = /overdue|due|jul/i.test(p.reporting);
      items.push({
        key: "rp-" + p.name, cat: "report", code: "RPT", codeColor: over ? "var(--red)" : "var(--ember)",
        title: `${p.name} — reporting due`, sub: p.reporting,
        pill: { cls: over ? "over" : "week", txt: over ? "Due" : "Upcoming" },
        view: "projects", tab: "pr-grants",
      });
    }
  }

  // 3. Milestones in progress / behind schedule
  for (const p of projects) {
    for (const m of p.milestones ?? []) {
      const dd = daysAway(m.end);
      const behind = m.s !== "done" && dd != null && dd < 0;
      if (m.s === "now" || behind) {
        items.push({
          key: "ms-" + p.name + m.t, cat: "milestone", code: "MS", codeColor: behind ? "var(--red)" : "var(--ember)",
          title: `${p.name} — ${m.t}`, sub: behind ? "milestone overdue" : "milestone in progress",
          pill: { cls: behind ? "over" : "today", txt: behind ? "Overdue" : "In progress" },
          view: "projects", tab: "pr-milestones",
        });
      }
    }
  }

  // 4. My tasks that are overdue or due soon
  for (const t of myWeek) {
    if (t.state === "done") continue;   // completed tasks stay visible in My Week but drop off the action feed
    if (meEmail && t.ownerEmail !== meEmail && !(t.assignees ?? []).some((a) => a.email === meEmail)) continue;
    const dd = daysAway(t.due);
    const overdue = t.p === "over" || (dd != null && dd < 0);
    const soon = dd != null && dd >= 0 && dd <= 2;
    if (overdue || soon || t.p === "today") {
      items.push({
        key: "tsk-" + t.id, cat: "task", code: "TSK", codeColor: overdue ? "var(--red)" : "var(--flame)",
        title: t.t, sub: t.assignedBy ? `assigned by ${t.assignedBy}` : "your task",
        pill: { cls: overdue ? "over" : "today", txt: overdue ? "Overdue" : t.pl || "Due" },
        view: "home",
      });
    }
  }

  // 5. Budget variances — cost lines / projects running hot
  for (const p of projects) {
    const burn = burnOf(p);
    if (burn >= 80) {
      items.push({
        key: "bud-" + p.name, cat: "budget", code: "£", codeColor: burn >= 100 ? "var(--red)" : "var(--ember)",
        title: `${p.name} — budget ${burn}% used`, sub: `${kesShort(spentOf(p))} of ${kesShort(budgetOf(p))}`,
        pill: { cls: burn >= 100 ? "over" : "today", txt: burn >= 100 ? "Over" : "Tight" },
        view: "projects", tab: "pr-budget",
      });
    }
  }

  // 6. Projects with no recent update
  for (const p of projects) {
    if ((daysAway(p.updatedAt) ?? 0) < -STALE_DAYS) {
      items.push({
        key: "stale-" + p.name, cat: "stale", code: "•", codeColor: "var(--ink-soft)",
        title: `${p.name} — no recent update`, sub: `last change ${Math.abs(daysAway(p.updatedAt)!)} days ago`,
        pill: { cls: "week", txt: "Stale" },
        view: "projects", tab: "pr-projects",
      });
    }
  }

  return items;
}

// Order categories by the signed-in user's dominant role so each person lands
// on what matters to them first. Roles come from the perms map (module → level).
export function orderForRole(perms: Record<string, number> | undefined): AttentionItem["cat"][] {
  const p = perms ?? {};
  const fin = (p.finance ?? 0) + (p.procurement ?? 0);
  const prog = (p.projects ?? 0) + (p.reports ?? 0);
  // Finance-heavy → approvals & budgets first; Programme-heavy → milestones & reports first.
  if (fin >= 4 && fin > prog) return ["approval", "budget", "task", "report", "milestone", "stale"];
  if (prog >= 3 && prog >= fin) return ["report", "milestone", "task", "approval", "budget", "stale"];
  return ["task", "approval", "report", "milestone", "budget", "stale"];
}
