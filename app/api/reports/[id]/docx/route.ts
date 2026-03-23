// app/api/reports/[id]/docx/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSignedReportUrl } from "@/lib/report/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function adminSupabase() {
  return createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

type Ctx = { params: { id: string } } | { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  // 0) Next 16: params can be Promise
  const params = "then" in (ctx as any).params ? await (ctx as any).params : (ctx as any).params;
  const reportId = params?.id;

  if (!reportId) return json({ ok: false, error: "Missing report id" }, 400);

  // 1) Auth user (cookie SSR)
  const supabaseSSR = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseSSR.auth.getUser();

  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  // 2) Read report using service role (avoid RLS issues)
  const admin = adminSupabase();
  const { data: report, error } = await admin
    .from("reports")
    .select("id, user_id, status, docx_path")
    .eq("id", reportId)
    .maybeSingle();

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!report) return json({ ok: false, error: "Report not found" }, 404);

  // 3) Ownership check
  if (report.user_id !== user.id) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  // 4) Must be ready + have docx_path
  if (report.status !== "ready") {
    return json({ ok: false, error: `Report not ready (${report.status})` }, 409);
  }
  if (!report.docx_path) {
    return json({ ok: false, error: "docx_path missing" }, 500);
  }

  // 5) Signed URL
  const url = await createSignedReportUrl({
    docxPath: report.docx_path,
    expiresInSeconds: 60 * 10,
  });

  return json({ ok: true, url }, 200);
}