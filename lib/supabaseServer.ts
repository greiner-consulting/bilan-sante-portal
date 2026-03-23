import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * SSR client (auth via cookies) — côté serveur
 * On caste en `any` pour ne pas être bloqué par des types Supabase (Database) obsolètes.
 * Long-terme : régénérer database.types.ts.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // certains contextes Next refusent setAll : on ignore
          }
        },
      },
    }
  );

  return client as any;
}

/**
 * Service role (bypass RLS) — UNIQUEMENT serveur
 * Cast en `any` => plus d'erreurs TS sur .from("...") quand le schéma a évolué.
 */
export function adminSupabase() {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return client as any;
}