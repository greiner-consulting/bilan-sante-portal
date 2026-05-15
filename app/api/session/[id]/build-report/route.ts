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

function buildPreview(params: { row: SessionRow; generatedAt: string }) {
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

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function textToUtf16BeHex(text: string) {
  const input = `\uFEFF${String(text ?? "")}`;
  const bytes: number[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }

  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stripForWrap(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

function wrapText(text: string, maxChars: number) {
  const words = stripForWrap(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function buildPdfBase64(preview: ReturnType<typeof buildPreview>) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 46;
  const topY = 790;
  const bottomY = 60;
  const lineHeight = 14;

  type PdfLine = {
    text: string;
    size: number;
    bold?: boolean;
    gapBefore?: number;
  };

  const logicalLines: PdfLine[] = [];

  function addText(text: string, size = 10, bold = false, gapBefore = 0) {
    const maxChars = size >= 18 ? 45 : size >= 14 ? 60 : 92;
    const lines = wrapText(text, maxChars);

    if (lines.length === 0) {
      logicalLines.push({ text: "", size, bold, gapBefore });
      return;
    }

    lines.forEach((line, index) => {
      logicalLines.push({
        text: line,
        size,
        bold,
        gapBefore: index === 0 ? gapBefore : 0,
      });
    });
  }

  addText(preview.title, 18, true, 0);
  addText(`Généré le ${preview.generatedAt}`, 9, false, 4);

  for (const section of preview.sections as any[]) {
    addText(section.title, 14, true, 18);

    for (const paragraph of section.paragraphs ?? []) {
      addText(paragraph, 10, false, 6);
    }

    for (const bullet of section.bullets ?? []) {
      addText(`• ${bullet}`, 10, false, 4);
    }

    for (const table of section.tables ?? []) {
      addText(table.title ?? "Tableau", 11, true, 10);
      addText(table.headers.join(" | "), 9, true, 4);

      for (const row of table.rows ?? []) {
        addText(row.join(" | "), 9, false, 3);
      }
    }
  }

  const pages: string[] = [];
  let current = "";
  let y = topY;

  function newPage() {
    if (current.trim()) pages.push(current);
    current = "";
    y = topY;
  }

  for (const line of logicalLines) {
    y -= line.gapBefore ?? 0;

    if (y < bottomY) {
      newPage();
    }

    const font = line.bold ? "F2" : "F1";
    const hex = textToUtf16BeHex(line.text);
    current += `BT /${font} ${line.size} Tf ${marginX} ${y} Td <${hex}> Tj ET\n`;
    y -= lineHeight;
  }

  if (current.trim()) pages.push(current);

  const objects: string[] = [];

  function addObject(content: string) {
    objects.push(content);
    return objects.length;
  }

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("PAGES_PLACEHOLDER");
  const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const pageIds: number[] = [];

  for (const pageContent of pages) {
    const contentId = addObject(
      `<< /Length ${Buffer.byteLength(pageContent, "utf8")} >>\nstream\n${pageContent}endstream`
    );

    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );

    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");

  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8").toString("base64");
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

    if (!isBypass() && String(session.user_id ?? "") !== effectiveUserId) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    if (
      session.phase !== "report_ready" &&
      session.phase !== "diagnostic_complete" &&
      session.phase !== "completed" &&
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
    const pdfBase64 = buildPdfBase64(preview);

    const pdfFileName = `${safeFileName(
      session.source_filename || "rapport-diagnostic"
    ).replace(/\.docx$/i, "")}_rapport_diagnostic.pdf`;

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
      pdfBase64,
      pdfFileName,
      compliance: {
        ok: true,
        warnings: [],
        summary: [
          "Rapport construit depuis le moteur lib/diagnostic.",
          "PDF généré sans appel au moteur lib/bilan-sante.",
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