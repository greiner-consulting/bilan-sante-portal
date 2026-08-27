import Link from "next/link";
import { requireAdminUser } from "@/lib/auth/access-control";
import PortalPageHeader from "@/app/components/PortalPageHeader";
import AccessAdminClient from "./AccessAdminClient";

export default async function AdminAccessPage() {
  const adminUser = await requireAdminUser();

  return (
    <main className="min-h-screen bg-[#DCE6EE] px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PortalPageHeader
          pageTitle="Administration des accès clients"
          description="Cette interface permet de créer un accès client, d’envoyer un lien de connexion, de fixer une date d’expiration et de supprimer un accès."
          userLabel="Admin connecté"
          userValue={adminUser.email ?? adminUser.id}
          actions={
            <>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-xl border border-[#B8C9D7] bg-white px-4 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EAF2F8]"
              >
                Retour au dashboard
              </Link>
              <Link
                href="/logout?next=/admin/login"
                className="inline-flex items-center justify-center rounded-xl border border-[#B8C9D7] bg-white px-4 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EAF2F8]"
              >
                Déconnexion
              </Link>
            </>
          }
        />

        <AccessAdminClient />
      </div>
    </main>
  );
}