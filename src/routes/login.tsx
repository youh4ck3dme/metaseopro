import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Prihlásenie — Písmo" },
      { name: "description", content: "Prihlás sa do Písmo a spusti AI nástroje pre SEO." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/plan" });
  }, [user, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/plan` },
        });
        if (error) throw error;
        toast.success("Účet vytvorený. Skontroluj email a potvrď registráciu.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/plan" });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const r = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/plan",
    });
    if (r.error) {
      toast.error(r.error.message ?? "Google sign-in zlyhal.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-page-bg flex items-center justify-center px-6">
      <Toaster />
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 inline-flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-[6px] bg-neutral-900 text-neutral-50">
            <span className="text-xs font-semibold">P</span>
          </div>
          <span className="text-lg font-medium tracking-tight">Písmo</span>
        </Link>

        <div className="rounded-[16px] bg-white p-8 shadow-sm ring-1 ring-black/5">
          <h1 className="font-serif text-3xl mb-2">
            {mode === "signin" ? "Prihlásenie" : "Vytvor účet"}
          </h1>
          <p className="text-sm text-neutral-500 mb-6">
            {mode === "signin"
              ? "Pristúp k SEO Audit a 30-dňovému Content Planu."
              : "Prvý 30-dňový plán máš zadarmo."}
          </p>

          <button
            onClick={google}
            disabled={busy}
            className="w-full mb-4 flex items-center justify-center gap-2 rounded-[8px] border border-neutral-200 bg-white py-2.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60"
          >
            Pokračovať cez Google
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="text-xs text-neutral-400">alebo</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[8px] border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Heslo (min. 6 znakov)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[8px] border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-[8px] bg-neutral-900 py-2.5 text-sm font-medium text-neutral-50 hover:bg-neutral-800 disabled:opacity-60"
            >
              {busy ? "..." : mode === "signin" ? "Prihlásiť sa" : "Registrovať"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-6 text-sm text-neutral-500 hover:text-neutral-900"
          >
            {mode === "signin"
              ? "Nemáš účet? Zaregistruj sa"
              : "Už máš účet? Prihlás sa"}
          </button>
        </div>
      </div>
    </div>
  );
}
