// lib/diagnostic/storage.ts
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminSupabase() {
  return createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

function bucketName() {
  return process.env.SUPABASE_DIAGNOSTICS_BUCKET || "diagnostics";
}

export async function uploadDiagnosticSourceDocx(params: {
  sessionId: string;
  filename: string;
  bytes: Buffer;
  mime: string;
}) {
  const admin = adminSupabase();
  const bucket = bucketName();

  const safeName = params.filename.replace(/[^\w.\- ]+/g, "_");
  const objectPath = `${params.sessionId}/${safeName || "trame.docx"}`;

  const { error } = await admin.storage.from(bucket).upload(objectPath, params.bytes, {
    contentType: params.mime || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return objectPath;
}