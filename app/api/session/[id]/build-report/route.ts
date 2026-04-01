import { NextResponse } from "next/server";
import { join } from "node:path";
import { createSupabaseServerClient, adminSupabase } from "@/lib/supabaseServer";
import { loadAggregate } from "@/lib/bilan-sante/session-repository";
import {
  buildHtmlDiagnosticReport,
  buildPreviewDiagnosticReport,
  buildStandardDiagnosticReport,
} from "@/lib/bilan-sante/report-builder";
import { runComplianceChecks } from "@/lib/bilan-sante/compliance-checker";
import { buildDiagnosticPdfBuffer } from "@/lib/bilan-sante/report-pdf";

export const runtime = "nodejs";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

function safeFilePart(value: string): string {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function getEffectiveUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) throw new Error("Missing DEV_BYPASS_USER_ID");
    return id;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }

  return user.id;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const effectiveUserId = await getEffectiveUserId();
    const admin = adminSupabase();

    const { data: sessionOwner, error: ownerErr } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id, source_filename")
      .eq("id", sessionId)
      .maybeSingle();

    if (ownerErr) {
      return NextResponse.json(
        { ok: false, error: ownerErr.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!sessionOwner) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!isBypass() && String(sessionOwner.user_id ?? "") !== effectiveUserId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const loaded = await loadAggregate(sessionId);
    if (!loaded.aggregate) {
      return NextResponse.json(
        { ok: false, error: "BILAN_STATE_NOT_FOUND" },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    const compliance = runComplianceChecks(loaded.aggregate);

    if (!compliance.isCompliant) {
      return NextResponse.json(
        {
          ok: false,
          error: "REPORT_COMPLIANCE_FAILED",
          blocking_issues: compliance.blockingIssues,
          warnings: compliance.warnings,
          summary: compliance.summary,
        },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }

    const report = buildStandardDiagnosticReport(loaded.aggregate, {
      companyLabel:
        loaded.row.source_filename ?? "Entreprise analysée (anonymisée)",
      dirigeantLabel: "Dirigeant (anonymisé)",
    });

    const preview = buildPreviewDiagnosticReport(report);
    const html = buildHtmlDiagnosticReport(report);
    const safeSessionId = safeFilePart(sessionId) || "session";
    const logoPath = join(process.cwd(), "public", "greiner-consulting-logo.png");
    const pdfBuffer = await buildDiagnosticPdfBuffer(report, { logoPath });

    return NextResponse.json(
      {
        ok: true,
        preview,
        html,
        pdfBase64: pdfBuffer.toString("base64"),
        pdfFileName: `Bilan_de_Sante_Rapport_Dirigeant_${safeSessionId}.pdf`,
        compliance: {
          ok: compliance.isCompliant,
          warnings: compliance.warnings,
          summary: compliance.summary,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Build report error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status: code, headers: { "Cache-Control": "no-store" } }
    );
  }
}
