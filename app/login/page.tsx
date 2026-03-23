import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import LoginForm from "./LoginForm";

type PageProps = {
  searchParams?: Promise<{ error?: string; success?: string; next?: string }>;
};

function decodeMaybe(v?: string) {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export default async function LoginPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const errorMsg = decodeMaybe(sp.error);
  const successMsg = decodeMaybe(sp.success);
  const next = decodeMaybe(sp.next) ?? "/dashboard";

  // Si déjà connecté -> redirect direct
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect(next);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 space-y-4 shadow-sm">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Connexion</h1>
          <p className="text-sm text-gray-600">Accède à ton espace diagnostic.</p>
        </header>

        {errorMsg ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">
            {errorMsg}
          </div>
        ) : null}

        {successMsg ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800 text-sm">
            {successMsg}
          </div>
        ) : null}

        <LoginForm next={next} />

        <div className="text-xs text-gray-500 text-center">
          <Link className="underline" href="/reset-password">
            Mot de passe oublié ?
          </Link>
        </div>
      </div>
    </main>
  );
}