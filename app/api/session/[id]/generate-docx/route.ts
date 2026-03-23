export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

import { adminSupabase, createSupabaseServerClient } from "@/lib/supabaseServer";
import { buildReport } from "@/lib/diagnostic/buildReport";
import { buildExecutiveSummary } from "@/lib/diagnostic/buildExecutiveSummary";
import { loadActiveTemplateBuffer } from "@/lib/report/loadTemplate";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function sha256(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function renderDocx(templateBuf: Buffer, data: any) {
  const zip = new PizZip(templateBuf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.setData(data);
  doc.render();

  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}

export async function POST(
  req: Request,
  ctx: { params: { id: string } }
) {
  const sessionId = ctx.params.id;
  if (!sessionId) return json({ ok: false, error: "Missing session id" }, 400);

  const supabaseSSR = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabaseSSR.auth.getUser();

  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  const admin = adminSupabase();

  const { data: session, error: sErr } = await admin
    .from("diagnostic_sessions")
    .select("id,user_id,status")
    .eq("id", sessionId)
    .maybeSingle();

  if (sErr) return json({ ok: false, error: sErr.message }, 500);
  if (!session) return json({ ok: false, error: "Session not found" }, 404);

  if (session.user_id !== user.id) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  // construire le rapport JSON
  let reportJson: any;

  try {
    reportJson = await buildReport(sessionId);
  } catch (e: any) {
    await admin.from("diagnostic_events").insert({
      session_id: sessionId,
      user_id: user.id,
      kind: "REPORT_JSON_FAILED",
      payload: { error: e.message ?? String(e) },
    });

    return json({ ok: false, error: e.message ?? String(e) }, 500);
  }

  // synthèse dirigeant
  try {
    await buildExecutiveSummary(sessionId);
  } catch (e: any) {
    await admin.from("diagnostic_events").insert({
      session_id: sessionId,
      user_id: user.id,
      kind: "EXEC_SUMMARY_FAILED",
      payload: { error: e.message ?? String(e) },
    });
  }

  // charger le template docx
  const templateBuf = await loadActiveTemplateBuffer();

  const docBuffer = renderDocx(templateBuf, reportJson);

  const hash = sha256(docBuffer);

  const path = `${sessionId}/diagnostic-${hash}.docx`;

  const bucket = "reports";

  const { error: uploadErr } = await admin.storage
    .from(bucket)
    .upload(path, docBuffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (uploadErr) return json({ ok: false, error: uploadErr.message }, 500);

  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);

  if (signErr) return json({ ok: false, error: signErr.message }, 500);

  return json({
    ok: true,
    report: {
      signed_url: signed.signedUrl,
      bucket,
      path,
    },
  });
}