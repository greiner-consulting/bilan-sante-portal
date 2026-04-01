import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeNext(value: string | null | undefined): string {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/")) return "/login";
  if (next.startsWith("//")) return "/login";
  return next;
}

async function logoutAndRedirect(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next") ?? "/login");

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL(next, url.origin));
}

export async function GET(request: Request) {
  return logoutAndRedirect(request);
}

export async function POST(request: Request) {
  return logoutAndRedirect(request);
}
