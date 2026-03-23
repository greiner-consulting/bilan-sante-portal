
import "server-only";

import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminSupabase() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

function bucketName() {
  return process.env.SUPABASE_REPORTS_BUCKET || "reports";
}

export async function uploadReportDocx(params: { reportId: string; bytes: Buffer }) {
  const admin = adminSupabase();
  const bucket = bucketName();

  // chemin storage stable (1 dossier par report)
  const objectPath = `${params.reportId}/rapport.docx`;

  const { error } = await admin.storage.from(bucket).upload(objectPath, params.bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return objectPath;
}

export async function createSignedReportUrl(params: { docxPath: string; expiresInSeconds: number }) {
  const admin = adminSupabase();
  const bucket = bucketName();

  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(params.docxPath, params.expiresInSeconds);

  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  if (!data?.signedUrl) throw new Error("Signed URL missing");
  return data.signedUrl;
}