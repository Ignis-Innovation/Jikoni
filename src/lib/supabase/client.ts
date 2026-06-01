"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for use in Client Components (carries the user session, RLS applies). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
