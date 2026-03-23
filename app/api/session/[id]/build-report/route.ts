// app/api/session/[id]/build-report/route.ts

import { NextResponse } from "next/server";
import { createSupabaseServerClient, adminSupabase } from "@/lib/supabaseServer";
import { loadAggregate } from "@/lib/bilan-sante/session-repository";
import { buildStandardDiagnosticReport } from "@/lib/bilan-sante/report-builder";
import { runComplianceChecks } from "@/lib/bilan-sante/compliance-checker";

export const runtime = "nodejs";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
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
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (ownerErr) {
      return NextResponse.json(
        { ok: false, error: ownerErr.message },
        { status: 500 }
      );
    }

    if (!sessionOwner) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    if (
      !isBypass() &&
      String(sessionOwner.user_id ?? "") !== effectiveUserId
    ) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const loaded = await loadAggregate(sessionId);
    if (!loaded.aggregate) {
      return NextResponse.json(
        { ok: false, error: "BILAN_STATE_NOT_FOUND" },
        { status: 409 }
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
        { status: 422 }
      );
    }

    const report = buildStandardDiagnosticReport(loaded.aggregate, {
      companyLabel: loaded.row.source_filename ?? "Entreprise analysée (anonymisée)",
      dirigeantLabel: "Dirigeant (anonymisé)",
    });

    return NextResponse.json({
      ok: true,
      report,
      compliance: {
        ok: compliance.isCompliant,
        warnings: compliance.warnings,
        summary: compliance.summary,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Build report error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status: code }
    );
  }
}