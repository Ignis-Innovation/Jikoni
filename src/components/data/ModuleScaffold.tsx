import { Card, PageHeader, StatChip, Badge } from "@/components/ui/primitives";
import { resourceIcon } from "@/lib/spine/icons";
import { Database } from "lucide-react";

// Friendly display names and descriptions for tables
const TABLE_METADATA: Record<string, { label: string; description: string }> = {
  institutions: { label: "Institutions", description: "Core organizations and their hierarchy" },
  departments: { label: "Departments", description: "Organizational departments" },
  projects: { label: "Projects", description: "Project tracking and planning" },
  locations: { label: "Locations", description: "Physical locations and facilities" },
  cost_centers: { label: "Cost Centers", description: "Budget and cost allocation centers" },
  accounts: { label: "Accounts", description: "Chart of accounts" },
  fiscal_periods: { label: "Fiscal Periods", description: "Financial reporting periods" },
  opening_balances: { label: "Opening Balances", description: "Account opening balances" },
  approval_chains: { label: "Approval Chains", description: "Approval workflows" },
  approval_steps: { label: "Approval Steps", description: "Steps within approval workflows" },
  approval_requests: { label: "Approval Requests", description: "Pending approvals" },
  approval_actions: { label: "Approval Actions", description: "Approval history and decisions" },
};

/** Placeholder for spine areas whose tables + APIs exist but whose full UI
 * arrives with a later phase. Keeps nav navigable and documents what's live. */
export function ModuleScaffold({
  group,
  title,
  blurb,
  tables,
}: {
  group: string;
  title: string;
  blurb: string;
  tables: { name: string; rows: number }[];
}) {
  const totalRows = tables.reduce((s, t) => s + t.rows, 0);
  
  const getTableInfo = (name: string) => {
    return TABLE_METADATA[name] || { label: name.replace(/_/g, " ").toUpperCase(), description: "Data records" };
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow={group} title={title} subtitle={blurb} icon={resourceIcon(undefined, group)} />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatChip label="live tables" value={tables.length} tone="green" />
        <StatChip label="total records" value={totalRows} tone="blue" />
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-foreground">Data Tables</h3>
          </div>
          <Badge tone="green">live</Badge>
        </div>

        {/* Table Header */}
        <div className="hidden grid-cols-3 gap-4 border-b border-border px-0 py-2 text-xs font-semibold text-muted-foreground md:grid">
          <div>Table</div>
          <div>Description</div>
          <div className="text-right">Records</div>
        </div>

        {/* Table Rows */}
        <div className="space-y-0">
          {tables.map((t, idx) => {
            const meta = getTableInfo(t.name);
            return (
              <div key={t.name} className={`grid grid-cols-1 gap-2 py-3 md:grid-cols-3 md:gap-4 ${idx < tables.length - 1 ? 'border-b border-border' : ''}`}>
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-muted-foreground md:hidden">Table</span>
                  <span className="font-medium text-foreground">{meta.label}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-muted-foreground md:hidden">Description</span>
                  <span className="text-sm text-muted-foreground">{meta.description}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-muted-foreground md:hidden">Records</span>
                  <div className="flex items-center justify-between md:justify-end">
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${t.rows === 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {t.rows} {t.rows === 1 ? "record" : "records"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-lg border border-dashed border-border bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <p className="font-medium">✓ System Ready</p>
          <p className="mt-1">Tables, security policies (RLS) and audit triggers are live. Full user interface will be available with the complete module release.</p>
        </div>
      </Card>
    </div>
  );
}
