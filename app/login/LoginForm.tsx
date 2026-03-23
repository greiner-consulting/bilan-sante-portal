import { loginAction } from "./actions";

export default function LoginForm({ next }: { next: string }) {
  return (
    <form action={loginAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1">
        <label className="text-sm font-medium">Email</label>
        <input
          name="email"
          type="email"
          className="w-full rounded-lg border px-3 py-2"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Mot de passe</label>
        <input
          name="password"
          type="password"
          className="w-full rounded-lg border px-3 py-2"
          required
        />
      </div>

      <button
        type="submit"
        className="w-full rounded-lg px-4 py-2 bg-black text-white"
      >
        Se connecter
      </button>
    </form>
  );
}