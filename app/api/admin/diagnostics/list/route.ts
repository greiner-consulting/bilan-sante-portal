import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabaseServer";
import { assertAdminUserOrThrow } from "@/lib/auth/access-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    await assertAdminUserOrThrow();

    const admin = adminSupabase();
    const { data, error } = await admin
      .from("diagnostic_sessions")
      .select(
        [
          "id",
          "user_id",
          "source_filename",
          "status",
          "phase",
          "created_at",
          "updated_at",
          "deleted_at",
        ].join(",")
      )
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const diagnostics = Array.isArray(data)
      ? data.map((row: any) => ({
          id: String(row.id ?? ""),
          user_id: row.user_id == null ? null : String(row.user_id),
          source_filename:
            row.source_filename == null ? null : String(row.source_filename),
          status: row.status == null ? null : String(row.status),
          phase: row.phase == null ? null : String(row.phase),
          created_at: row.created_at == null ? null : String(row.created_at),
          updated_at: row.updated_at == null ? null : String(row.updated_at),
          deleted_at: row.deleted_at == null ? null : String(row.deleted_at),
          final_report_ready:
            String(row.phase ?? "") === "report_ready" ||
            String(row.status ?? "") === "report_ready" ||
            String(row.status ?? "") === "completed",
        }))
      : [];

    return json({ ok: true, diagnostics });
  } catch (e: any) {
    const msg = e?.message ?? "ADMIN_DIAGNOSTICS_LIST_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}
