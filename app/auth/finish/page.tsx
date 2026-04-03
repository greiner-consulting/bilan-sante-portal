import { Suspense } from "react";
import AuthFinishPageClient from "./AuthFinishPageClient";

export default function AuthFinishPage() {
  return (
    <Suspense fallback={<AuthFinishFallback />}>
      <AuthFinishPageClient />
    </Suspense>
  );
}

function AuthFinishFallback() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl border bg-white p-10 shadow-sm">
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold text-slate-900">
            Finalisation de la connexion…
          </h1>
          <p className="text-sm leading-6 text-slate-700">
            Préparation de la redirection sécurisée…
          </p>
        </div>
      </div>
    </main>
  );
}