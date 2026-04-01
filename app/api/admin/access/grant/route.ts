import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabaseServer";
import {
  appBaseUrl,
  assertAdminUserOrThrow,
} from "@/lib/auth/access-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

async function findUserByEmail(email: string) {
  const admin = adminSupabase();
  const result = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  const users = result?.data?.users ?? [];
  return users.find((item: any) => String(item.email ?? "").toLowerCase() === email) ?? null;
}

export async function POST(req: Request) {
  try {
    const adminUser = await assertAdminUserOrThrow();
    const body = await req.json();

    const email = normalizeEmail(body?.email);
    const expiresAt = body?.expiresAt ? String(body.expiresAt) : null;
    const notes = body?.notes ? String(body.notes).trim() : null;
    const grantAdmin = Boolean(body?.grantAdmin);

    if (!email) {
      return json({ ok: false, error: "Adresse e-mail requise." }, 400);
    }

    const admin = adminSupabase();
    const existingUser = await findUserByEmail(email);

    if (existingUser?.id) {
      const { error: entitlementError } = await admin
        .from("entitlements")
        .upsert(
          {
            user_id: existingUser.id,
            email_snapshot: email,
            is_active: true,
            expires_at: expiresAt,
            notes,
            granted_by: adminUser.id,
            granted_at: new Date().toISOString(),
            revoked_at: null,
          },
          { onConflict: "user_id" }
        );

      if (entitlementError) {
        throw new Error(entitlementError.message);
      }

      if (grantAdmin) {
        const { error: adminError } = await admin
          .from("admin_users")
          .upsert(
            {
              user_id: existingUser.id,
              email_snapshot: email,
              is_active: true,
              granted_by: adminUser.id,
              granted_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );

        if (adminError) {
          throw new Error(adminError.message);
        }
      }

      return json({
        ok: true,
        message: "Accès activé ou prolongé pour un utilisateur existant.",
      });
    }

    const { error: invitationError } = await admin
      .from("client_access_invitations")
      .upsert(
        {
          email,
          access_expires_at: expiresAt,
          notes,
          is_admin: grantAdmin,
          is_active: true,
          invited_by: adminUser.id,
          invited_at: new Date().toISOString(),
          consumed_by: null,
          consumed_at: null,
        },
        { onConflict: "email" }
      );

    if (invitationError) {
      throw new Error(invitationError.message);
    }

    const inviteRedirectTo = `${await appBaseUrl()}/auth/finish?next=${encodeURIComponent(
      "/dashboard"
    )}`;

    const inviteResult = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteRedirectTo,
    });

    if (inviteResult.error) {
      throw new Error(inviteResult.error.message);
    }

    return json({
      ok: true,
      message: "Invitation créée et e-mail de connexion envoyé.",
    });
  } catch (e: any) {
    const msg = e?.message ?? "AUTH_ADMIN_GRANT_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}
