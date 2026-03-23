// app/access/[token]/page.tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient, adminSupabase } from "@/lib/supabaseServer";
import { sha256Base64Url } from "@/lib/security/token";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function AccessRedeemPage(props: PageProps) {
  const { token } = await props.params;
  const tokenHash = sha256Base64Url(token);

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Pas connecté -> login puis retour
  if (!user) {
    redirect(`/login?error=${encodeURIComponent("Connecte-toi pour activer ton accès.")}&next=${encodeURIComponent(`/access/${token}`)}`);
  }

  const admin = adminSupabase();

  // Charge l’invite
  const { data: invite, error: invErr } = await admin
    .from("access_invites")
    .select("id,email,session_id,expires_at,max_uses,uses")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (invErr || !invite) {
    redirect(`/dashboard?error=${encodeURIComponent("Lien invalide ou expiré.")}`);
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    redirect(`/dashboard?error=${encodeURIComponent("Lien expiré.")}`);
  }
  if (invite.uses >= invite.max_uses) {
    redirect(`/dashboard?error=${encodeURIComponent("Lien déjà utilisé.")}`);
  }

  // Optionnel: vérifier email du user (si tu imposes que le compte Supabase = email invité)
  // if (user.email?.toLowerCase() !== invite.email) { ... }

  if (!invite.session_id) {
    redirect(`/dashboard?error=${encodeURIComponent("Invitation sans session associée.")}`);
  }

  // Crée le grant (4h par défaut: ici on utilise la fin de validité du lien comme fin de grant)
  const expiresAt = invite.expires_at;

  const { error: gErr } = await admin.from("access_grants").insert({
    user_id: user.id,
    session_id: invite.session_id,
    granted_by: user.id, // si tu veux: plutôt "created_by" => charge-le aussi dans select
    expires_at: expiresAt,
  });

  if (gErr) {
    redirect(`/dashboard?error=${encodeURIComponent(gErr.message)}`);
  }

  // Consomme l’invite
  await admin
    .from("access_invites")
    .update({ uses: invite.uses + 1 })
    .eq("id", invite.id);

  // Go session
  redirect(`/dashboard/${invite.session_id}?ok=${encodeURIComponent("Accès activé ✅")}`);
}