import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { extractLegacyDocumentText } from "@/lib/diagnostic/legacyDocumentToText";

export const runtime = "nodejs";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

async function getUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) {
      throw new Error("Missing DEV_BYPASS_USER_ID");
    }
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

function sanitizeField(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  try {
    await getUserId();

    const formData = await req.formData();

    const file = formData.get("file");
    const sourceRef = sanitizeField(formData.get("source_ref"));
    const companyName = sanitizeField(formData.get("company_name"));
    const sector = sanitizeField(formData.get("sector"));
    const sizeBand = sanitizeField(formData.get("size_band"));
    const geography = sanitizeField(formData.get("geography"));
    const manualContent = sanitizeField(formData.get("content"));

    if (!sourceRef) {
      return NextResponse.json(
        { ok: false, error: "Missing source_ref" },
        { status: 400 }
      );
    }

    let content = manualContent;
    let detectedFormat: string | null = null;
    let filename: string | null = null;

    if (!content) {
      if (!(file instanceof File)) {
        return NextResponse.json(
          { ok: false, error: "Missing file or content" },
          { status: 400 }
        );
      }

      filename = file.name || null;

      const extracted = await extractLegacyDocumentText({
        buffer: await file.arrayBuffer(),
        mimeType: file.type,
        filename: file.name,
      });

      content = extracted.text;
      detectedFormat = extracted.detected_format;
    }

    if (!content || content.length < 80) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Le contenu extrait est trop court pour produire des patterns fiables.",
        },
        { status: 400 }
      );
    }

    const origin = new URL(req.url).origin;

    const ingestRes = await fetch(`${origin}/api/diagnostic/ingest-legacy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({
        diagnostics: [
          {
            source_ref: sourceRef,
            company_name: companyName || undefined,
            sector: sector || undefined,
            size_band: sizeBand || undefined,
            geography: geography || undefined,
            content,
          },
        ],
      }),
    });

    const ingestJson = await ingestRes.json();

    if (!ingestRes.ok || !ingestJson?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: ingestJson?.error || "Ingestion failed",
        },
        { status: ingestRes.status || 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      source_ref: sourceRef,
      filename,
      detected_format: detectedFormat,
      extracted_length: content.length,
      inserted: ingestJson.inserted ?? 0,
      diagnostics_received: ingestJson.diagnostics_received ?? 1,
      message: "Diagnostic historique ingéré avec succès.",
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, error: msg },
      { status: code }
    );
  }
}