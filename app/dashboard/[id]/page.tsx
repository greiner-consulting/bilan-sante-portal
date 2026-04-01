import { redirect } from "next/navigation";
import SessionWorkspace from "./SessionWorkspace";
import { getAuthenticatedUserOrThrow, isAdminUser } from "@/lib/auth/access-control";
import { adminSupabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function DiagnosticSessionPage({ params }: Props) {
  const { id: sessionId } = await params;
  const user = await getAuthenticatedUserOrThrow();
  const admin = adminSupabase();

  const { data: session, error } = await admin
    .from("diagnostic_sessions")
    .select("id, user_id, deleted_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!session || session.deleted_at) {
    redirect("/dashboard?error=Diagnostic%20introuvable%20ou%20supprim%C3%A9.");
  }

  const adminUser = await isAdminUser(user.id);
  if (!adminUser && String(session.user_id ?? "") !== user.id) {
    redirect("/dashboard?error=Acc%C3%A8s%20non%20autoris%C3%A9%20%C3%A0%20cette%20session.");
  }

  return <SessionWorkspace sessionId={sessionId} />;
}
