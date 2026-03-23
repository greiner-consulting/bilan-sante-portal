export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminSupabase } from "@/lib/supabaseServer";

const pdf = require("pdf-parse/lib/pdf-parse.js");

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

type IngestBody = {
  session_id: string;
  pdf_path: string;
  bucket?: string;
};

function sha256(u8: Uint8Array) {
  return crypto.createHash("sha256").update(Buffer.from(u8)).digest("hex");
}

async function extractPdfText(u8: Uint8Array) {
  const result = await pdf(Buffer.from(u8));
  const full_text = String(result?.text ?? "").trim();

  const pages =
    typeof result?.numpages === "number" && result.numpages > 0
      ? result.numpages
      : 1;

  const pages_text = full_text ? [full_text] : [];

  return { pages, pages_text, full_text };
}

function buildSections(pagesText: string[]) {
  const anchors = [
    { key: "IDENTIFICATION", patterns: [/identification/i, /informations générales/i] },
    { key: "HISTORIQUE", patterns: [/historique/i, /contexte/i] },
    { key: "FINANCES_3_ANS", patterns: [/trois dernières années/i, /3 dernières années/i, /résultats/i] },
    { key: "RH_SECURITE", patterns: [/rh/i, /ressources humaines/i, /sécurité/i, /accidents/i] },
    { key: "TOP_CLIENTS", patterns: [/top\s*10\s*clients/i, /principaux clients/i] },
    { key: "PIPELINE", patterns: [/pipeline/i, /commerce/i, /commercial/i] },
    { key: "PILOTAGE", patterns: [/pilotage/i, /organisation/i, /rituels/i] },
    { key: "RISQUES", patterns: [/risques/i] },
  ];

  const hits: Array<{ anchor: string; page: number }> = [];

  pagesText.forEach((t, idx) => {
    for (const a of anchors) {
      if (a.patterns.some((rx) => rx.test(t))) {
        hits.push({ anchor: a.key, page: idx + 1 });
        break;
      }
    }
  });

  const unique = Array.from(new Map(hits.map((h) => [h.anchor, h])).values()).sort(
    (a, b) => a.page - b.page
  );

  return unique.map((h, i) => {
    const next = unique[i + 1];
    return {
      anchor: h.anchor,
      page_from: h.page,
      page_to: next ? Math.max(h.page, next.page - 1) : pagesText.length,
    };
  });
}

export async function POST(req: Request) {
  try {
    let body: IngestBody;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const sessionId = body.session_id;
    const pdfPath = body.pdf_path;
    const bucket = body.bucket || process.env.SUPABASE_TRAMES_BUCKET || "trames";

    if (!sessionId || !pdfPath) {
      return json({ ok: false, error: "Missing session_id or pdf_path" }, 400);
    }

    const admin = adminSupabase();

    const { data: session, error: sErr } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id, status, source_doc_path")
      .eq("id", sessionId)
      .maybeSingle();

    if (sErr) return json({ ok: false, error: sErr.message }, 500);
    if (!session) return json({ ok: false, error: "Session not found" }, 404);

    const { data: file, error: dErr } = await admin.storage.from(bucket).download(pdfPath);
    if (dErr) {
      return json(
        { ok: false, error: `Storage download failed: ${dErr.message}` },
        404
      );
    }

    const ab = await file.arrayBuffer();
    const u8 = new Uint8Array(ab);
    const hash = sha256(u8);

    let pages = 0;
    let pages_text: string[] = [];
    let full_text = "";

    try {
      const extracted = await extractPdfText(u8);
      pages = extracted.pages;
      pages_text = extracted.pages_text;
      full_text = extracted.full_text;
    } catch (e: any) {
      return json(
        {
          ok: false,
          error: `PDF text extraction failed: ${e?.message ?? String(e)}`,
        },
        500
      );
    }

    const sections = buildSections(pages_text);

    const missing_fields: string[] = [];
    const quality_flags: string[] = [];
    if (sections.length === 0) quality_flags.push("NO_ANCHORS_DETECTED");

    const trameIndex = {
      meta: {
        version: "1.0",
        parsed_at: new Date().toISOString(),
        sha256: hash,
        pages,
        bucket,
        pdf_path: pdfPath,
      },
      sections,
      tables: {
        finances_3ans: [],
        rh_securite: null,
        top_clients: [],
        pipeline: null,
      },
      missing_fields,
      quality_flags,
    };

    const { data: idxRow, error: iErr } = await admin
      .from("trame_indexes")
      .insert({
        session_id: sessionId,
        user_id: session.user_id,
        index_version: "1.0",
        index_json: trameIndex,
      })
      .select("id")
      .single();

    if (iErr) return json({ ok: false, error: iErr.message }, 500);

    const { error: uErr } = await admin
      .from("diagnostic_sessions")
      .update({
        status: "in_progress",
        source_doc_path: pdfPath,
        trame_sha256: hash,
        trame_pages: pages,
        trame_index_id: idxRow.id,
        extracted_text: full_text,
      })
      .eq("id", sessionId);

    if (uErr) return json({ ok: false, error: uErr.message }, 500);

    const { error: eErr } = await admin.from("diagnostic_events").insert({
      session_id: sessionId,
      user_id: session.user_id,
      kind: "TRAME_INGESTED",
      payload: {
        trame_index_id: idxRow.id,
        sha256: hash,
        pages,
        pdf_path: pdfPath,
        bucket,
        quality_flags,
        missing_fields_count: missing_fields.length,
        auth_mode: "local-test-no-auth",
      },
    });

    if (eErr) {
      console.error("diagnostic_events insert failed:", eErr.message);
    }

    return json(
      {
        ok: true,
        status: "in_progress",
        trame_index_id: idxRow.id,
        missing_fields_count: missing_fields.length,
        quality_flags,
        auth_mode: "local-test-no-auth",
      },
      200
    );
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: e?.message || "Ingest route failed",
      },
      500
    );
  }
}