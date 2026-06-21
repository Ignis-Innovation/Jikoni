import { Card, PageHeader } from "@/components/ui/primitives";
import { resourceIcon } from "@/lib/spine/icons";

/** Placeholder for spine areas whose tables + APIs exist but whose full UI
 * arrives with a later phase. Keeps nav navigable and documents what's live. */
export function ModuleScaffold({
  group,
  title,
  blurb,
}: {
  group: string;
  title: string;
  blurb: string;
  tables: { name: string; rows: number }[];
}) {
  return (
    <div className="w-full">
      <PageHeader eyebrow={group} title={title} subtitle={blurb} icon={resourceIcon(undefined, group)} />

      <Card>
        <div className="rounded-lg border border-dashed border-border bg-flame-soft px-4 py-3 text-sm text-flame">
          <p className="font-medium">System ready</p>
          <p className="mt-1 leading-relaxed">
            Tables, security policies (RLS) and audit triggers are live. The full interface for this module
            arrives with its complete release.
          </p>
        </div>
      </Card>
    </div>
  );
}
