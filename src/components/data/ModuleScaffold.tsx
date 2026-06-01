import { Card } from "@/components/ui/primitives";
import { Database } from "lucide-react";

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
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <p className="text-xs text-zinc-400">{group}</p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        <p className="text-sm text-zinc-500">{blurb}</p>
      </div>
      <Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-700">
          <Database className="h-4 w-4 text-emerald-600" /> Spine tables (live)
        </div>
        <ul className="divide-y divide-zinc-100">
          {tables.map((t) => (
            <li key={t.name} className="flex items-center justify-between py-2 text-sm">
              <span className="font-mono text-xs text-zinc-700">{t.name}</span>
              <span className="text-zinc-500">{t.rows} rows</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-zinc-400">
          Tables, triggers (audit + events) and RLS are in place. The full screens land with this module&apos;s phase.
        </p>
      </Card>
    </div>
  );
}
