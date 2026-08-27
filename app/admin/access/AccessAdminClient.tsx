"use client";

import { useEffect, useMemo, useState } from "react";

type EntitlementRow = {
  user_id: string;
  email_snapshot: string | null;
  is_active: boolean | null;
  expires_at: string | null;
  granted_at: string | null;
  notes: string | null;
};

type InvitationRow = {
  id: string;
  email: string;
  access_expires_at: string | null;
  invited_at: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  notes: string | null;
};

type AccessListResponse = {
  ok: boolean;
  entitlements: EntitlementRow[];
  invitations: InvitationRow[];
  error?: string;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

const cardClass = "rounded-2xl border border-[#B8C9D7] bg-white p-6 shadow-[0_10px_30px_rgba(23,58,94,0.09)]";
const inputClass = "w-full rounded-xl border border-[#B8C9D7] bg-[#F8FBFD] px-3 py-2.5 text-sm text-[#223E58] outline-none transition focus:border-[#3676A8] focus:bg-white focus:ring-2 focus:ring-[#DCEAF5]";
const thClass = "border border-[#C6D4DF] bg-[#EAF2F8] px-3 py-2.5 text-left text-[#173A5E]";
const tdClass = "border border-[#D4DFE7] bg-white px-3 py-2.5 text-[#43566B]";

export default function AccessAdminClient() {
  const [email, setEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [grantAdmin, setGrantAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);

  async function loadData() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/access/list", { method: "GET", credentials: "include", cache: "no-store" });
      const data: AccessListResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "Impossible de charger les accès.");
      setEntitlements(Array.isArray(data.entitlements) ? data.entitlements : []);
      setInvitations(Array.isArray(data.invitations) ? data.invitations : []);
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/access/grant", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, expiresAt: expiresAt || null, notes, grantAdmin }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Impossible de créer l’accès.");
      setMessage(data.message || "Accès créé avec succès.");
      setEmail("");
      setExpiresAt("");
      setNotes("");
      setGrantAdmin(false);
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(payload: { userId?: string; invitationId?: string }) {
    const confirmed = window.confirm(payload.userId ? "Confirmez-vous la suppression définitive de cet accès ?" : "Confirmez-vous la suppression définitive de cette invitation ?");
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/access/revoke", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Impossible de supprimer l’accès.");
      setMessage(data.message || "Suppression effectuée.");
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  const activeEntitlements = useMemo(() => entitlements.filter((item) => item.is_active), [entitlements]);
  const activeInvitations = useMemo(() => invitations.filter((item) => item.is_active), [invitations]);

  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <div className="border-b border-[#DFE8EF] pb-4">
          <h2 className="text-lg font-semibold text-[#173A5E]">Créer ou prolonger un accès</h2>
          <p className="mt-1 text-sm text-[#66788A]">Si le client n’a pas encore de compte, une invitation e-mail sera envoyée. S’il a déjà un compte, son accès sera activé ou prolongé.</p>
        </div>

        <form onSubmit={handleGrant} className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <label className="text-sm font-medium text-[#294762]">E-mail client</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className={inputClass} placeholder="client@entreprise.fr" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[#294762]">Date d’expiration</label>
            <input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} type="datetime-local" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[#294762]">Note interne</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} type="text" className={inputClass} placeholder="Client projet X / accès 30 jours" />
          </div>
          <label className="flex items-center gap-3 text-sm text-[#43566B] md:col-span-2">
            <input checked={grantAdmin} onChange={(e) => setGrantAdmin(e.target.checked)} type="checkbox" /> Donner aussi un droit administrateur
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={loading} className="rounded-xl bg-[#173A5E] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#214F7B] disabled:opacity-50">
              {loading ? "Traitement..." : "Créer / prolonger l’accès"}
            </button>
            <button type="button" onClick={loadData} disabled={refreshing} className="rounded-xl border border-[#B8C9D7] bg-white px-4 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EAF2F8]">
              {refreshing ? "Actualisation..." : "Actualiser"}
            </button>
          </div>
        </form>

        {message ? <div className="mt-4 rounded-xl border border-[#9FD6C5] bg-[#E7F6F0] p-3 text-sm text-[#1E6654]">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      </section>

      <section className={cardClass}>
        <div className="flex items-center justify-between border-b border-[#DFE8EF] pb-4">
          <h2 className="text-lg font-semibold text-[#173A5E]">Accès actifs</h2>
          <span className="rounded-full bg-[#EAF2F8] px-3 py-1 text-xs font-semibold text-[#3676A8]">{activeEntitlements.length} actifs</span>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[#C6D4DF]">
          <table className="min-w-full border-collapse text-sm">
            <thead><tr><th className={thClass}>E-mail</th><th className={thClass}>Expire le</th><th className={thClass}>Accordé le</th><th className={thClass}>Note</th><th className={thClass}>Action</th></tr></thead>
            <tbody>
              {activeEntitlements.length === 0 ? <tr><td className={tdClass} colSpan={5}>Aucun accès actif.</td></tr> : activeEntitlements.map((item) => (
                <tr key={item.user_id} className="hover:bg-[#F5F8FA]">
                  <td className={tdClass}>{item.email_snapshot || item.user_id}</td><td className={tdClass}>{formatDateTime(item.expires_at)}</td><td className={tdClass}>{formatDateTime(item.granted_at)}</td><td className={tdClass}>{item.notes || "—"}</td>
                  <td className={tdClass}><button type="button" onClick={() => handleRevoke({ userId: item.user_id })} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">Supprimer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cardClass}>
        <div className="flex items-center justify-between border-b border-[#DFE8EF] pb-4">
          <h2 className="text-lg font-semibold text-[#173A5E]">Invitations en attente</h2>
          <span className="rounded-full bg-[#FFF4DF] px-3 py-1 text-xs font-semibold text-[#9A641E]">{activeInvitations.length} en attente</span>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[#C6D4DF]">
          <table className="min-w-full border-collapse text-sm">
            <thead><tr><th className={thClass}>E-mail</th><th className={thClass}>Expire le</th><th className={thClass}>Invité le</th><th className={thClass}>Rôle</th><th className={thClass}>Action</th></tr></thead>
            <tbody>
              {activeInvitations.length === 0 ? <tr><td className={tdClass} colSpan={5}>Aucune invitation active.</td></tr> : activeInvitations.map((item) => (
                <tr key={item.id} className="hover:bg-[#F5F8FA]">
                  <td className={tdClass}>{item.email}</td><td className={tdClass}>{formatDateTime(item.access_expires_at)}</td><td className={tdClass}>{formatDateTime(item.invited_at)}</td><td className={tdClass}>{item.is_admin ? "Admin" : "Client"}</td>
                  <td className={tdClass}><button type="button" onClick={() => handleRevoke({ invitationId: item.id })} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">Supprimer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
