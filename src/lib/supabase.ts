import { createClient } from "@supabase/supabase-js";

// Single browser Supabase client for the whole SPA. Session persists in
// localStorage and is auto-refreshed. All access is governed by RLS, so the
// client only ever holds the anon key — never the service_role key.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "jikoni-auth",
    },
  }
);
