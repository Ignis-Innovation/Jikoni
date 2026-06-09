import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
if (!supabaseConfigured) {
  console.error(
    "[Jikoni] Missing environment variables: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY."
  );
}

// Single browser Supabase client for the whole SPA. The session is persisted
// per-tab (sessionStorage) rather than per-browser (localStorage): refreshing
// keeps you signed in, but opening the app in a new tab or after closing it
// requires logging in again — so a fresh visit lands on /login, not the
// dashboard. All access is governed by RLS, so the client only ever holds the
// anon key — never the service_role key.
export const supabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_ANON_KEY || "",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "jikoni-auth",
      storage: window.sessionStorage,
    },
  }
);
