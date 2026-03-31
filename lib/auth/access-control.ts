import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminSupabase, createSupabaseServerClient } from "@/lib/supabaseServer";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export type ActiveEntitlement = {
  user_id: string;
  email_snapshot?: string | null;
  is_active: boolean | null;
  expires_at: string | null;
  granted_at?: string | null;
  revoked_at?: string | null;
  notes?: string | null;
};

type AdminUserRow = {
  user_id: string;
  is_active: boolean | null;
};

type InvitationRow = {
  id: string;
  email: string;
  access_expires_at: string | null;
  notes: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  invited_by: string | null;
};

function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isBypassEnabled(): boolean {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

export async function appBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/g, "");
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`.replace(/\/+$/g, "");
}

export async function getAuthenticatedUserOrThrow(): Promise<AuthenticatedUser> {
  if (isBypassEnabled()) {
    const userId = process.env.DEV_BYPASS_USER_ID;
    if (!userId) throw new Error("Missing DEV_BYPASS_USER_ID");
    return {
      id: userId,
      email: process.env.DEV_BYPASS_USER_EMAIL ?? null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }

  return {
    id: user.id,
    email: user.email ?? null,
  };
}

export async function getActiveEntitlementForUser(
  userId: string
): Promise<ActiveEntitlement | null> {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("entitlements")
    .select("user_id, email_snapshot, is_active, expires_at, granted_at, revoked_at, notes")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`ENTITLEMENT_LOAD_FAILED: ${error.message}`);
  }

  return (data as ActiveEntitlement | null) ?? null;
}

export function entitlementIsUsable(
  entitlement: Pick<ActiveEntitlement, "is_active" | "expires_at"> | null
): boolean {
  if (!entitlement?.is_active) return false;
  if (!entitlement.expires_at) return true;
  return new Date(entitlement.expires_at).getTime() >= Date.now();
}

export async function assertEntitledUserOrThrow(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUserOrThrow();
  const entitlement = await getActiveEntitlementForUser(user.id);

  if (!entitlementIsUsable(entitlement)) {
    throw new Error("FORBIDDEN");
  }

  return user;
}

export async function requireEntitledUser(): Promise<AuthenticatedUser> {
  try {
    return await assertEntitledUserOrThrow();
  } catch (error: any) {
    if (error?.message === "FORBIDDEN") {
      redirect("/login?error=Votre%20acc%C3%A8s%20client%20n%27est%20pas%20actif.");
    }
    throw error;
  }
}

export async function isAdminUser(userId: string): Promise<boolean> {
  if (isBypassEnabled()) return true;

  const admin = adminSupabase();
  const { data, error } = await admin
    .from("admin_users")
    .select("user_id, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`ADMIN_ROLE_LOAD_FAILED: ${error.message}`);
  }

  const row = (data as AdminUserRow | null) ?? null;
  return Boolean(row?.is_active);
}

export async function assertAdminUserOrThrow(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUserOrThrow();
  const isAdmin = await isAdminUser(user.id);

  if (!isAdmin) {
    throw new Error("FORBIDDEN");
  }

  return user;
}

export async function requireAdminUser(): Promise<AuthenticatedUser> {
  try {
    return await assertAdminUserOrThrow();
  } catch (error: any) {
    if (error?.message === "FORBIDDEN") {
      redirect("/dashboard?error=Acc%C3%A8s%20administrateur%20requis.");
    }
    throw error;
  }
}

export async function syncPendingInvitationForUser(params: {
  userId: string;
  email: string | null | undefined;
}): Promise<void> {
  const email = normalizeEmail(params.email);
  if (!email) return;

  const admin = adminSupabase();

  const { data, error } = await admin
    .from("client_access_invitations")
    .select("id, email, access_expires_at, notes, is_admin, is_active, invited_by")
    .eq("email", email)
    .eq("is_active", true)
    .order("invited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`INVITATION_LOAD_FAILED: ${error.message}`);
  }

  const invitation = (data as InvitationRow | null) ?? null;
  if (!invitation) return;

  const entitlementPayload = {
    user_id: params.userId,
    email_snapshot: email,
    is_active: true,
    expires_at: invitation.access_expires_at,
    notes: invitation.notes,
    granted_by: invitation.invited_by,
    granted_at: new Date().toISOString(),
    revoked_at: null,
  };

  const { error: entitlementError } = await admin
    .from("entitlements")
    .upsert(entitlementPayload, { onConflict: "user_id" });

  if (entitlementError) {
    throw new Error(`INVITATION_SYNC_FAILED: ${entitlementError.message}`);
  }

  if (invitation.is_admin) {
    const { error: adminError } = await admin
      .from("admin_users")
      .upsert(
        {
          user_id: params.userId,
          email_snapshot: email,
          is_active: true,
          granted_by: invitation.invited_by,
          granted_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (adminError) {
      throw new Error(`ADMIN_SYNC_FAILED: ${adminError.message}`);
    }
  }

  const { error: invitationUpdateError } = await admin
    .from("client_access_invitations")
    .update({
      is_active: false,
      consumed_by: params.userId,
      consumed_at: new Date().toISOString(),
    })
    .eq("id", invitation.id);

  if (invitationUpdateError) {
    throw new Error(`INVITATION_CLOSE_FAILED: ${invitationUpdateError.message}`);
  }
}
