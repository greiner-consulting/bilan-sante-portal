// app/api/bootstrap/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function POST() {
  try {
    // 1️⃣ Vérifie session utilisateur via cookie Supabase
    const supabaseSSR = await createSupabaseServerClient();

    const {
      data: { user },
      error: userErr,
    } = await supabaseSSR.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2️⃣ Client admin (service role)
    const admin = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // 3️⃣ Vérifie si entitlement existe déjà
    const { data: existing } = await admin
      .from("entitlements")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const now = new Date();
    const expires = addDays(now, 30); // 30 jours d'accès

    if (existing) {
      // Mise à jour
      await admin
        .from("entitlements")
        .update({
          is_active: true,
          starts_at: now.toISOString(),
          expires_at: expires.toISOString(),
        })
        .eq("user_id", user.id);
    } else {
      // Création
      await admin.from("entitlements").insert({
        user_id: user.id,
        is_active: true,
        starts_at: now.toISOString(),
        expires_at: expires.toISOString(),
        created_at: now.toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      message: "Bootstrap completed",
      expires_at: expires.toISOString(),
    });
  } catch (err: any) {
    console.error("BOOTSTRAP ERROR:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Bootstrap failed" },
      { status: 500 }
    );
  }
}

// ✅ Permet test direct dans navigateur
export async function GET() {
  return POST();
}