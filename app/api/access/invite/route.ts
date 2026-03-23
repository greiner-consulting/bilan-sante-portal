// app/api/access/invite/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, adminSupabase } from "@/lib/supabaseServer";
import { newToken, sha256Base64Url } from "@/lib/security/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

// TODO: remplace par ton client Brevo (ou fetch API Brevo)
async function sendInviteEmail(params: { to: string; link: string; expiresAt: string }) {
  // Intégration Brevo: à brancher chez toi (tu as déjà Brevo en stack)
  console.log("[brevo] send invite", params);
}

export async function POST(req: Request) {
  const supabaseSSR = await createSupabaseServerClient();
  const { data: { user } } = await supabaseSSR.auth.getUser();
  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const hours = Number(body.hours ?? 4);
  const sessionId = body.session_id ? String(body.session_id) : null;

  if (!email || !email.includes("@")) return json({ ok: false, error: "Invalid email" }, 400);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
    return json({ ok: false, error: "hours must be between 1 and 72" }, 400);
  }

  const token = newToken(32);
  const tokenHash = sha256Base64Url(token);
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  const admin = adminSupabase();
  const { data: row, error } = await admin
    .from("access_invites")
    .insert({
      created_by: user.id,
      email,
      session_id: sessionId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      max_uses: 1,
      uses: 0,
    })
    .select("id")
    .single();

  if (error) return json({ ok: false, error: error.message }, 500);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const link = `${baseUrl}/access/${encodeURIComponent(token)}`;

  await sendInviteEmail({ to: email, link, expiresAt });

  return json({ ok: true, invite_id: row.id, link, expires_at: expiresAt }, 200);
}

export async function GET() {
  return json({ ok: false, error: "Method Not Allowed" }, 405);
}