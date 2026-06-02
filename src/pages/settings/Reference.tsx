import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/useData";
import { Card, Badge } from "@/components/ui/primitives";

export default function Reference() {
  const { data } = useData(async () => {
    const [{ data: currencies }, { data: taxes }, { data: uoms }, { data: cats }] = await Promise.all([
      supabase.from("currencies").select("*").order("code"),
      supabase.from("tax_codes").select("*").order("code"),
      supabase.from("units_of_measure").select("*").order("code"),
      supabase.from("categories").select("*").is("deleted_at", null).order("domain"),
    ]);
    return { currencies: currencies ?? [], taxes: taxes ?? [], uoms: uoms ?? [], cats: cats ?? [] };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">Settings</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Reference Data</h1>
        <p className="text-sm text-muted-foreground">Shared lookups every dropdown in Jikoni reads from.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Currencies</h2>
          <ul className="space-y-1 text-sm">
            {(data?.currencies ?? []).map((c) => (
              <li key={c.code} className="flex justify-between"><span className="text-foreground">{c.name}</span><span className="font-mono text-muted-foreground">{c.symbol} {c.code}</span></li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Tax codes</h2>
          <ul className="space-y-1 text-sm">
            {(data?.taxes ?? []).map((t) => (
              <li key={t.code} className="flex justify-between"><span className="text-foreground">{t.name}</span><span className="font-mono text-muted-foreground">{t.rate_pct}%</span></li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Units of measure</h2>
          <div className="flex flex-wrap gap-1.5">
            {(data?.uoms ?? []).map((u) => <Badge key={u.code} tone="zinc">{u.code} · {u.name}</Badge>)}
          </div>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Categories</h2>
          <div className="flex flex-wrap gap-1.5">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {((data?.cats ?? []) as any[]).map((c) => <Badge key={c.id} tone="blue">{c.domain}: {c.name}</Badge>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
