"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  sessionId: string;
};

export default function DeleteDiagnosticButton({ sessionId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      "Confirmer la suppression de ce diagnostic ? Cette session disparaîtra de votre tableau de bord."
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/delete`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Suppression impossible.");
      }
      router.refresh();
    } catch (error: any) {
      window.alert(error?.message || "Suppression impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
    >
      {loading ? "Suppression..." : "Supprimer"}
    </button>
  );
}
