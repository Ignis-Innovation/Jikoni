import { createClient } from "@supabase/supabase-js";

// Single browser Supabase client for the whole SPA. The session is persisted
// per-tab (sessionStorage) rather than per-browser (localStorage): refreshing
// keeps you signed in, but opening the app in a new tab or after closing it
// requires logging in again — so a fresh visit lands on /login, not the
// dashboard. All access is governed by RLS, so the client only ever holds the
// anon key — never the service_role key.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "jikoni-auth",
      storage: window.sessionStorage,
    },
  }
);
