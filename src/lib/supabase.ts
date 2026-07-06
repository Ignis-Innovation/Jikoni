import { createClient } from "@supabase/supabase-js";

// The anon key is public by design (it ships to every browser); RLS + auth
// gate all data. Fallbacks let static hosts (Vercel) build without env config.
const url = import.meta.env.VITE_SUPABASE_URL || "https://jaqiscfiqzkmdvvubmzf.supabase.co";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphcWlzY2ZpcXprbWR2dnVibXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjg1NjEsImV4cCI6MjA5NTkwNDU2MX0.5gK2V6J2bIgDll7YglmkrDEDbNiOnSDe5swljcvmNrk";

export const supabase = createClient(url, anonKey);
