import { requireAdminUser } from "@/lib/auth/access-control";
import AccessAdminClient from "./AccessAdminClient";

export default async function AdminAccessPage() {
  const adminUser = await requireAdminUser();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Administration des accès clients
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
                Cette interface permet de créer un accès client, d’envoyer un lien
                de connexion, de fixer une date d’expiration et de révoquer un accès.
              </p>
            </div>
            <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Admin connecté : <span className="font-medium">{adminUser.email ?? adminUser.id}</span>
            </div>
          </div>
        </section>

        <AccessAdminClient />
      </div>
    </main>
  );
}
