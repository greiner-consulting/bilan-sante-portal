import { redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  adminSupabase,
} from "@/lib/supabaseServer";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

export default function DashboardPage() {
  async function createSession() {
    "use server";

    if (isBypass()) {
      const userId = process.env.DEV_BYPASS_USER_ID;
      if (!userId) {
        throw new Error("Missing DEV_BYPASS_USER_ID");
      }

      const admin = adminSupabase();

      const { data, error } = await admin
        .from("diagnostic_sessions")
        .insert({
          user_id: userId,
          status: "collected",
        })
        .select()
        .single();

      if (error) {
        console.error(error);
        throw new Error("Erreur création session");
      }

      redirect(`/dashboard/${data.id}`);
    }

    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("Utilisateur non connecté");
    }

    const { data, error } = await supabase
      .from("diagnostic_sessions")
      .insert({
        user_id: user.id,
        status: "collected",
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      throw new Error("Erreur création session");
    }

    redirect(`/dashboard/${data.id}`);
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <form action={createSession}>
        <button className="px-4 py-2 bg-black text-white rounded">
          Nouvelle session
        </button>
      </form>
    </main>
  );
}