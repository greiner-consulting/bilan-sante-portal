// lib/supabaseClient.ts
import { createBrowserClient } from "@supabase/ssr";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const supabase = createBrowserClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
);