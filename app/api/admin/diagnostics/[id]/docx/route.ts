import { NextResponse } from "next/server";
import { assertAdminUserOrThrow } from "@/lib/auth/access-control";
import { loadAggregate } from "@/lib/bilan-sante/session-repository";
import { buildStandardDiagnosticReport } from "@/lib/bilan-sante/report-builder";
import { buildDiagnosticDocxBuffer } from "@/lib/bilan-sante/report-docx";
import { runComplianceChecks } from "@/lib/bilan-sante/compliance-checker";

export const runtime = "nodejs";

function safeFilePart(value: string): string {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await assertAdminUserOrThrow();
    const { id: sessionId } = await context.params;

    const loaded = await loadAggregate(sessionId);
    if (!loaded.aggregate) {
      return json({ ok: false, error: "BILAN_STATE_NOT_FOUND" }, 409);
    }

    const compliance = runComplianceChecks(loaded.aggregate);
    if (!compliance.isCompliant) {
      return json(
        {
          ok: false,
          error: "REPORT_COMPLIANCE_FAILED",
          blocking_issues: compliance.blockingIssues,
          warnings: compliance.warnings,
          summary: compliance.summary,
        },
        422
      );
    }

    const report = buildStandardDiagnosticReport(loaded.aggregate, {
      companyLabel: loaded.row.source_filename ?? "Entreprise analysée (anonymisée)",
      dirigeantLabel: "Dirigeant (anonymisé)",
    });

    const docxBuffer = await buildDiagnosticDocxBuffer(report);
    const safeSessionId = safeFilePart(sessionId) || "session";
    const filename = `Bilan_de_Sante_Rapport_Dirigeant_${safeSessionId}.docx`;

    return new NextResponse(docxBuffer, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "ADMIN_DIAGNOSTIC_DOCX_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}
