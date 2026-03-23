"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function DebugSessionPage() {
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const { data: sData, error: sErr } = await supabase.auth.getSession();
        if (sErr) setError(`getSession error: ${sErr.message}`);
        setSession(sData?.session ?? null);

        const { data: uData, error: uErr } = await supabase.auth.getUser();
        if (uErr) setError((prev) => prev + `\ngetUser error: ${uErr.message}`);
        setUser(uData?.user ?? null);
      } catch (e: any) {
        setError(`exception: ${e?.message ?? String(e)}`);
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
      <h1>Debug session</h1>

      <h3>USER</h3>
      {user ? JSON.stringify(user, null, 2) : "null"}

      <h3>SESSION</h3>
      {session ? JSON.stringify(session, null, 2) : "null"}

      <h3>ERROR</h3>
      {error || "none"}
    </main>
  );
}
