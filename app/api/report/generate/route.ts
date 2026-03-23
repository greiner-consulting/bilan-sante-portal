// app/api/report/generate/route.ts
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { uploadReportDocx } from "@/lib/report/storage";
import { REPORT_SCHEMA } from "@/lib/reportSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---- helpers ---- */
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

/**
 * OpenAI "strict json_schema" requires:
 * - for every object schema with `properties`, a `required` array MUST exist
 * - and it MUST include *every* key in `properties`
 *
 * => We enforce that rule at runtime so we never get 400 Invalid schema.
 */
function enforceOpenAIStrictSchema(schema: any): any {
  const seen = new WeakSet<object>();

  const walk = (node: any): any => {
    if (!node || typeof node !== "object") return node;
    if (seen.has(node)) return node;
    seen.add(node);

    // Draft metadata not necessary here (and sometimes problematic)
    if (node.$schema) delete node.$schema;

    if (node.type === "object" && node.properties && typeof node.properties === "object") {
      const keys = Object.keys(node.properties);
      node.required = keys; // <- enforce OpenAI strict rule
      // recurse into each property schema
      for (const k of keys) walk(node.properties[k]);
    }

    // arrays: recurse into items
    if (node.type === "array" && node.items) {
      walk(node.items);
    }

    // anyOf/oneOf/allOf: recurse
    for (const comb of ["anyOf", "oneOf", "allOf"] as const) {
      if (Array.isArray(node[comb])) {
        for (const sub of node[comb]) walk(sub);
      }
    }

    return node;
  };

  // clone to avoid mutating imported constant
  const cloned = JSON.parse(JSON.stringify(schema));
  return walk(cloned);
}

function safeParseJson(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? String(e) };
  }
}

/** ---- route ---- */
export async function POST(req: Request) {
  // 1) Auth (SSR cookies)
  const supabaseSSR = await createSupabaseServerClient();
  const { data: { user } } = await supabaseSSR.auth.getUser();

  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  // 2) Admin client (service role)
  const admin = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  // 3) entitlement
  const { data: ent, error: entErr } = await admin
    .from("entitlements")
    .select("is_active, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (entErr) return json({ ok: false, error: entErr.message }, 500);
  if (!ent?.is_active) return json({ ok: false, error: "No entitlement" }, 403);
  if (ent.expires_at && new Date(ent.expires_at).getTime() < Date.now()) {
    return json({ ok: false, error: "Access expired" }, 403);
  }

  // 4) input
  const input = await req.json().catch(() => ({}));

  // 5) create report row
  const { data: created, error: createErr } = await admin
    .from("reports")
    .insert({
      user_id: user.id,
      status: "queued",
      schema_version: "1.0",
      input,
    })
    .select("id")
    .single();

  if (createErr || !created?.id) {
    return json({ ok: false, error: createErr?.message ?? "Create report failed" }, 500);
  }

  const reportId = created.id as string;

  try {
    await admin.from("reports").update({ status: "generating" }).eq("id", reportId);

    // 6) OpenAI strict JSON schema (normalized)
    const openai = new OpenAI({ apiKey: mustEnv("OPENAI_API_KEY") });

    const schemaForOpenAI = enforceOpenAIStrictSchema(REPORT_SCHEMA.schema);

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      input: [
        {
          role: "system",
          content:
            "Retourne STRICTEMENT un JSON valide conforme au schéma. " +
            "Si une info est inconnue, utilise null quand le schéma l'autorise. " +
            "Aucune phrase, aucun markdown.",
        },
        { role: "user", content: JSON.stringify(input) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: REPORT_SCHEMA.name,
          schema: schemaForOpenAI,
          strict: true,
        },
      },
    });

    const raw = (response as any).output_text;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new Error("OpenAI returned empty output_text");
    }

    const parsed = safeParseJson(raw);
    if (!parsed.ok) {
      // log raw to help debug formatting issues
      console.error("[report/generate] JSON parse error:", parsed.error);
      console.error("[report/generate] output_text:", raw.slice(0, 2000));
      throw new Error(`Invalid JSON returned by model: ${parsed.error}`);
    }

    const reportJson = parsed.value;

    // 7) DOCX generation
    const templatePath = path.join(process.cwd(), "templates", "Bilan_de_Sante_Template_v2.docx");
    if (!fs.existsSync(templatePath)) throw new Error(`Template not found: ${templatePath}`);

    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{", end: "}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });

    doc.setData(reportJson);
    doc.render();

    const buffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });

    // 8) upload storage
    const docxPath = await uploadReportDocx({ reportId, bytes: buffer });

    await admin
      .from("reports")
      .update({
        status: "ready",
        report_json: reportJson,
        docx_path: docxPath,
        error: null,
      })
      .eq("id", reportId);

    return json({ ok: true, report_id: reportId }, 200);
  } catch (e: any) {
    console.error("[report/generate] failed:", e);

    await admin
      .from("reports")
      .update({ status: "failed", error: e?.message ?? String(e) })
      .eq("id", reportId);

    return json(
      { ok: false, error: e?.message ?? "Generation failed", report_id: reportId },
      500
    );
  }
}

export async function GET() {
  return json({ ok: false, error: "Method Not Allowed" }, 405);
}