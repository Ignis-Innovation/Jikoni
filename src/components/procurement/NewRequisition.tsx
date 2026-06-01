"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/primitives";
import { Plus } from "lucide-react";

export function NewRequisition() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("requisitions")
      .insert({ status: "draft", currency_code: "KES", total_minor: 0 })
      .select("id")
      .single();
    setBusy(false);
    if (error) return alert(error.message);
    router.push(`/procurement/requisitions/${data.id}`);
  }

  return (
    <Button onClick={create} disabled={busy}>
      <Plus className="h-4 w-4" /> {busy ? "Creating…" : "New requisition"}
    </Button>
  );
}
