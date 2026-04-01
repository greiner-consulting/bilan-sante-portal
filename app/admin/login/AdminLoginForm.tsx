import { adminLoginAction } from "./actions";

export default function AdminLoginForm({ next }: { next: string }) {
  return (
    <form action={adminLoginAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">Adresse e-mail</label>
        <input
          name="email"
          type="email"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-500"
          placeholder="contact@greiner-consulting.fr"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">Mot de passe</label>
        <input
          name="password"
          type="password"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-500"
          placeholder="Votre mot de passe"
          required
        />
      </div>

      <button
        type="submit"
        className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Se connecter
      </button>
    </form>
  );
}
