import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  adminSupabase,
} from "@/lib/supabaseServer";
import { normalizeDiagnosticResult } from "@/lib/diagnostic/diagnosticState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (!user) throw new Error("UNAUTHENTICATED");
  return user.id;
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

type SessionRow = {
  id: string;
  user_id: string | null;
  source_filename: string | null;
  status: string | null;
  phase: string | null;
  diagnostic_result_json: unknown;
  final_objectives_json: unknown;
  updated_at: string | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeFinalObjectives(raw: unknown) {
  if (!raw || typeof raw !== "object") return [];

  const source = raw as any;
  const values = Array.isArray(source.objectives)
    ? source.objectives
    : Array.isArray(raw)
    ? raw
    : [];

  return values
    .map((o: any, index: number) => ({
      id: String(o?.id ?? `obj-${index + 1}`),
      dimensionId: o?.dimensionId ?? o?.dimension ?? "",
      objectiveLabel: String(o?.objectiveLabel ?? o?.objectif ?? "").trim(),
      owner: String(o?.owner ?? o?.responsable ?? "").trim(),
      keyIndicator: String(o?.keyIndicator ?? o?.indicateur ?? "").trim(),
      dueDate: String(o?.dueDate ?? o?.echeance ?? "").trim(),
      potentialGain: String(o?.potentialGain ?? o?.gain_potentiel ?? "").trim(),
      gainHypotheses: Array.isArray(o?.gainHypotheses)
        ? o.gainHypotheses.map(String).filter(Boolean)
        : String(o?.hypotheses ?? "")
        ? [String(o.hypotheses)]
        : [],
    }))
    .filter((o: any) => o.objectiveLabel || o.keyIndicator || o.potentialGain);
}

function buildPreview(params: {
  row: SessionRow;
  generatedAt: string;
}) {
  const { row, generatedAt } = params;
  const diagnostic = normalizeDiagnosticResult(row.diagnostic_result_json);
  const objectives = normalizeFinalObjectives(row.final_objectives_json);

  const sections: any[] = [
    {
      id: "synthese",
      title: "Synthèse du diagnostic",
      paragraphs: [
        diagnostic.synthesis ||
          "Le diagnostic a été consolidé à partir des quatre dimensions explorées.",
      ],
    },
  ];

  for (const dimension of diagnostic.dimensions) {
    sections.push({
      id: `dimension-${dimension.dimension}`,
      title: `Dimension ${dimension.dimension} — ${dimension.name}`,
      bullets: [
        ...dimension.constats_cles.map((x) => `Constat : ${x}`),
        dimension.cause_racine
          ? `Cause racine dominante : ${dimension.cause_racine}`
          : "",
      ].filter(Boolean),
      tables:
        dimension.zones_non_pilotees.length > 0
          ? [
              {
                title: "Zones non pilotées",
                headers: ["Zone", "Risque"],
                rows: dimension.zones_non_pilotees.map((zone) => [
                  zone,
                  "Cette zone doit être sécurisée dans le plan d’actions.",
                ]),
              },
            ]
          : [],
    });
  }

  if (diagnostic.transformation_priorities.length > 0) {
    sections.push({
      id: "priorites",
      title: "Priorités de transformation",
      bullets: diagnostic.transformation_priorities,
    });
  }

  if (objectives.length > 0) {
    sections.push({
      id: "objectifs",
      title: "Objectifs orientés résultats",
      tables: [
        {
          title: "Objectifs proposés",
          headers: [
            "Dimension",
            "Objectif",
            "Responsable",
            "Indicateur",
            "Échéance",
            "Gain potentiel",
          ],
          rows: objectives.map((o: any) => [
            String(o.dimensionId || "—"),
            o.objectiveLabel || "—",
            o.owner || "—",
            o.keyIndicator || "—",
            o.dueDate || "—",
            o.potentialGain || "—",
          ]),
        },
      ],
    });
  }

  return {
    title: `Rapport de diagnostic — ${
      row.source_filename || "Entreprise analysée"
    }`,
    generatedAt,
    sections,
  };
}

function buildHtml(preview: ReturnType<typeof buildPreview>) {
  const sectionsHtml = preview.sections
    .map((section: any) => {
      const paragraphs = (section.paragraphs ?? [])
        .map((p: string) => `<p>${escapeHtml(p)}</p>`)
        .join("");

      const bullets =
        section.bullets?.length > 0
          ? `<ul>${section.bullets
              .map((b: string) => `<li>${escapeHtml(b)}</li>`)
              .join("")}</ul>`
          : "";

      const tables = (section.tables ?? [])
        .map((table: any) => {
          const headers = table.headers
            .map((h: string) => `<th>${escapeHtml(h)}</th>`)
            .join("");

          const rows = table.rows
            .map(
              (row: string[]) =>
                `<tr>${row
                  .map((cell) => `<td>${escapeHtml(cell)}</td>`)
                  .join("")}</tr>`
            )
            .join("");

          return `
            <h3>${escapeHtml(table.title ?? "")}</h3>
            <table>
              <thead><tr>${headers}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          `;
        })
        .join("");

      return `
        <section>
          <h2>${escapeHtml(section.title)}</h2>
          ${paragraphs}
          ${bullets}
          ${tables}
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(preview.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 40px; line-height: 1.5; }
    h1 { font-size: 26px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin-top: 32px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    h3 { font-size: 15px; margin-top: 18px; }
    p, li, td, th { font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    th { background: #f3f4f6; text-align: left; }
  </style>
</head>
<body>
  <h1>${escapeHtml(preview.title)}</h1>
  <p>Généré le ${escapeHtml(preview.generatedAt)}</p>
  ${sectionsHtml}
</body>
</html>`;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;

    if (!sessionId) {
      return json({ ok: false, error: "Missing session id" }, 400);
    }

    const effectiveUserId = await getEffectiveUserId();
    const admin = adminSupabase();

    const { data: row, error } = await admin
      .from("diagnostic_sessions")
      .select(
        "id, user_id, source_filename, status, phase, diagnostic_result_json, final_objectives_json, updated_at"
      )
      .eq("id", sessionId)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) return json({ ok: false, error: "Session not found" }, 404);

    const session = row as SessionRow;

    if (
      !isBypass() &&
      String(session.user_id ?? "") !== effectiveUserId
    ) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    if (
      session.phase !== "report_ready" &&
      session.phase !== "diagnostic_complete" &&
      session.status !== "report_ready" &&
      session.status !== "completed"
    ) {
      return json(
        {
          ok: false,
          error: "REPORT_NOT_READY",
          phase: session.phase,
          status: session.status,
        },
        409
      );
    }

    const diagnostic = normalizeDiagnosticResult(session.diagnostic_result_json);

    if (!diagnostic.dimensions || diagnostic.dimensions.length === 0) {
      return json(
        {
          ok: false,
          error: "DIAGNOSTIC_RESULT_EMPTY",
        },
        409
      );
    }

    const generatedAt = new Date().toISOString();
    const preview = buildPreview({ row: session, generatedAt });
    const html = buildHtml(preview);

    await admin
      .from("diagnostic_sessions")
      .update({
        status: "completed",
        phase: "completed",
        updated_at: generatedAt,
      })
      .eq("id", sessionId);

    return json({
      ok: true,
      preview,
      html,
      compliance: {
        ok: true,
        warnings: [],
        summary: [
          "Rapport construit depuis le moteur lib/diagnostic.",
          "Aucun appel au moteur lib/bilan-sante.",
        ],
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Build report error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;

    return json(
      {
        ok: false,
        error: msg,
      },
      code
    );
  }
}

export async function GET() {
  return json({ ok: false, error: "Method Not Allowed" }, 405);
}