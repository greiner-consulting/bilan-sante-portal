import path from "node:path";
import { NextResponse } from "next/server";
import { assertAdminUserOrThrow } from "@/lib/auth/access-control";
import { loadAggregate } from "@/lib/bilan-sante/session-repository";
import { buildStandardDiagnosticReport } from "@/lib/bilan-sante/report-builder";
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

async function resolvePdfBuilder(): Promise<
  ((report: unknown, options?: Record<string, unknown>) => Promise<Buffer> | Buffer) | null
> {
  const pdfModule = await import("@/lib/bilan-sante/report-pdf");

  const candidates = [
    (pdfModule as any).buildDiagnosticPdfBuffer,
    (pdfModule as any).buildReportPdfBuffer,
    (pdfModule as any).buildDiagnosticReportPdfBuffer,
    (pdfModule as any).default,
  ];

  return candidates.find((item) => typeof item === "function") ?? null;
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

    const buildPdf = await resolvePdfBuilder();
    if (!buildPdf) {
      return json(
        {
          ok: false,
          error: "PDF_BUILDER_NOT_FOUND",
          detail:
            "Aucune fonction PDF reconnue n’a été trouvée dans lib/bilan-sante/report-pdf.",
        },
        500
      );
    }

    const pdfBuffer = await buildPdf(report, {
      logoPath: path.join(process.cwd(), "public", "greiner-consulting-logo.png"),
    });

    const safeSessionId = safeFilePart(sessionId) || "session";
    const filename = `Bilan_de_Sante_Rapport_Dirigeant_${safeSessionId}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "ADMIN_DIAGNOSTIC_PDF_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}
