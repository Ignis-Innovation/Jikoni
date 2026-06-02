import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/primitives";
import { Plus } from "lucide-react";

export function NewRequisition() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const { data, error } = await supabase
      .from("requisitions")
      .insert({ status: "draft", currency_code: "KES", total_minor: 0 })
      .select("id")
      .single();
    setBusy(false);
    if (error) return alert(error.message);
    navigate(`/procurement/requisitions/${data.id}`);
  }

  return (
    <Button onClick={create} disabled={busy}>
      <Plus className="h-4 w-4" /> {busy ? "Creating…" : "New requisition"}
    </Button>
  );
}
