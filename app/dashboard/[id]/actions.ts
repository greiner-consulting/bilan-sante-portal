"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, adminSupabase } from "@/lib/supabaseServer";

export type UploadState = {
  ok: boolean;
  message?: string;
  error?: string;
  path?: string;
};

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

async function getUserIdForRequest(): Promise<string> {
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

function sanitizeFilename(name: string) {
  return String(name || "trame.pdf")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function tramesBucket() {
  return (process.env.SUPABASE_TRAMES_BUCKET || "trames").trim();
}

export async function uploadAndIngestTrameAction(
  sessionId: string,
  formData: FormData
): Promise<UploadState> {
  try {
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return { ok: false, error: "Fichier manquant" };
    }

    if (file.size === 0) {
      return { ok: false, error: "Fichier vide" };
    }

    const userId = await getUserIdForRequest();
    const admin = adminSupabase();

    const { data: existing, error: existingError } = await admin
      .from("diagnostic_sessions")
      .select("id,user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (existingError) {
      return { ok: false, error: existingError.message };
    }

    if (!existing) {
      return { ok: false, error: "Session introuvable" };
    }

    if (existing.user_id !== userId) {
      return { ok: false, error: "Accès interdit" };
    }

    const filename = sanitizeFilename(file.name);
    const sourceMime = file.type || "application/pdf";
    const bucket = tramesBucket();
    const path = `${userId}/${Date.now()}-${filename}`;

    if (
      !sourceMime.toLowerCase().includes("pdf") &&
      !filename.toLowerCase().endsWith(".pdf")
    ) {
      return {
        ok: false,
        error: "Format de trame non pris en charge. Merci d’envoyer un PDF.",
      };
    }

    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(path, arrayBuffer, {
        contentType: sourceMime,
        upsert: false,
      });

    if (uploadError) {
      return { ok: false, error: uploadError.message };
    }

    /**
     * Important :
     * on appelle ensuite la vraie route d’ingestion,
     * qui calcule l’index et met à jour trame_index_id + extracted_text.
     */
    const ingestUrl = `${
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    }/api/trame/ingest`;

    const ingestRes = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        pdf_path: path,
        bucket,
      }),
    });

    let ingestData: any = null;
    try {
      ingestData = await ingestRes.json();
    } catch {
      return {
        ok: false,
        error: "Réponse invalide de la route d’ingestion",
      };
    }

    if (!ingestRes.ok || !ingestData?.ok) {
      return {
        ok: false,
        error: ingestData?.error || "Échec de l’ingestion de la trame",
      };
    }

    revalidatePath(`/dashboard/${sessionId}`);

    return {
      ok: true,
      message: "Trame uploadée et ingérée avec succès",
      path,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ?? "Unknown error",
    };
  }
}

export async function uploadTrameAction(
  sessionId: string,
  formData: FormData
): Promise<UploadState> {
  return uploadAndIngestTrameAction(sessionId, formData);
}

export async function ingestTrameAction(
  _prevState: UploadState,
  formData: FormData
): Promise<UploadState> {
  try {
    const sessionId = String(formData.get("sessionId") ?? "").trim();

    if (!sessionId) {
      return { ok: false, error: "Session manquante" };
    }

    return {
      ok: false,
      error:
        "Cette action n’est plus utilisée seule. Utilisez uploadAndIngestTrameAction.",
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ?? "Unknown error",
    };
  }
}