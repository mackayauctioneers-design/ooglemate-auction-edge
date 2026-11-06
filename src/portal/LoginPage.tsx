import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import carbitrageLogo from "@/assets/carbitrage-logo.jpg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, portalApi } from "./api";

const PERSONAS = [
  { id: "patrick", label: "Patrick Auto", detail: "Standalone franchise. No Ooglecars yard." },
  { id: "north", label: "KTMG North", detail: "One store. Cannot see KTMG South." },
  { id: "group", label: "KTMG group", detail: "Explicit membership on North and South." },
  { id: "outsider", label: "Other Motors", detail: "A different dealership." },
] as const;

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    document.title = "Sign in | Carbitrage";
    portalApi.health().then((health) => setDemoMode(health.demoMode)).catch(() => setDemoMode(false));
    portalApi.me().then(() => navigate("/portal/finds", { replace: true })).catch(() => undefined);
  }, [navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await portalApi.login(email, password);
      navigate("/portal/finds");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function enterDemo(persona: string) {
    setBusy(true);
    setError(null);
    try {
      await portalApi.demo(persona);
      navigate("/portal/finds");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Demo sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <header className="bg-neutral-950 text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <img src={carbitrageLogo} alt="Carbitrage" className="h-8 w-auto bg-white object-contain" />
          <div>
            <p className="text-sm font-semibold tracking-tight">Carbitrage</p>
            <p className="text-xs text-neutral-300">Dealer portal</p>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-2 md:py-16">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Your yard's finds, DNA and alerts.</h1>
          <p className="mt-3 text-neutral-600">
            A standalone product for a dealership or franchise group. Ooglecars can supply data later. It is not required to sign in.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-neutral-700">
            <li>Floors exclude government charges and show their source.</li>
            <li>Another yard's sales and stock stay on their account.</li>
            <li>This preview uses labelled synthetic examples. Billing is off.</li>
          </ul>
        </section>
        <section className="border border-neutral-200 p-5">
          <h2 className="text-lg font-semibold">Sign in</h2>
          <form className="mt-4 space-y-3" onSubmit={onSubmit}>
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            {error ? <p role="alert" className="text-sm">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {demoMode ? (
            <div className="mt-6 border-t border-neutral-200 pt-4">
              <p className="text-sm font-medium">Synthetic preview accounts</p>
              <p className="mt-1 text-xs text-neutral-500">Local demo only. These accounts are not real dealers.</p>
              <div className="mt-3 grid gap-2">
                {PERSONAS.map((persona) => (
                  <button
                    key={persona.id}
                    type="button"
                    data-testid={`persona-${persona.id}`}
                    disabled={busy}
                    onClick={() => enterDemo(persona.id)}
                    className="border border-neutral-300 px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <span className="block text-sm font-medium">{persona.label}</span>
                    <span className="block text-xs text-neutral-500">{persona.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
