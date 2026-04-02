import Link from "next/link";
import { requireAdminUser } from "@/lib/auth/access-control";
import PortalPageHeader from "@/app/components/PortalPageHeader";
import DiagnosticsAdminClient from "./DiagnosticsAdminClient";

export default async function AdminDiagnosticsPage() {
  const adminUser = await requireAdminUser();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PortalPageHeader
          pageTitle="Diagnostics réalisés"
          description="Cette interface permet à l’administrateur de consulter les sessions, d’ouvrir un diagnostic, de télécharger les exports PDF / DOCX et de supprimer un dossier si nécessaire."
          userLabel="Admin connecté"
          userValue={adminUser.email ?? adminUser.id}
          actions={
            <>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
              >
                Retour au dashboard
              </Link>
              <Link
                href="/logout?next=/admin/login"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
              >
                Déconnexion
              </Link>
            </>
          }
        />

        <DiagnosticsAdminClient />
      </div>
    </main>
  );
}