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

function json(
  body: any,
  init?: { status?: number; headers?: Record<string, string> }
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export async function GET(_req: Request, ctx: any) {
  const params =
    ctx?.params && typeof ctx.params.then === "function" ? await ctx.params : ctx?.params;

  const id = params?.id as string | undefined;
  if (!id) return json({ ok: false, error: "Missing id param" }, { status: 400 });

  const supabaseSSR = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseSSR.auth.getUser();

  if (!user) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const admin = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  const { data, error } = await admin
    .from("reports")
    .select("id,status,schema_version,input,report_json,docx_path,error,created_at,updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return json({ ok: false, error: error?.message ?? "Not found" }, { status: 404 });
  }

  return json({ ok: true, report: data });
}