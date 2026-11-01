import { Button } from "@/components/ui/button";
import { ChartNoAxesCombined, ArrowRight } from "lucide-react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : "/",
  }),
  head: () => ({
    meta: [
      { title: "Prihlásenie — SEO4WEB" },
      { name: "description", content: "Prihlás sa do SEO4WEB a spusti AI nástroje pre SEO." },
      { property: "og:title", content: "Prihlásenie — SEO4WEB" },
      { property: "og:description", content: "Prihlás sa do svojho SEO4WEB pracovného priestoru." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: redirect });
  }, [user, loading, navigate, redirect]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}${redirect}` },
        });
        if (error) throw error;
        toast.success("Účet vytvorený. Skontroluj email a potvrď registráciu.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: redirect });
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
      redirect_uri: window.location.origin + redirect,
    });
    if (r.error) {
      toast.error(r.error.message ?? "Google sign-in zlyhal.");
      setBusy(false);
    }
  };

  return (
    <div className="auth-page flex min-h-screen items-center justify-center px-6 py-12">
      <Toaster />
      <div className="w-full max-w-md">
        <Link to="/" className="mb-10 inline-flex items-center gap-3" aria-label="SEO4WEB — úvod">
          <span className="brand-mark flex size-10 items-center justify-center rounded-lg"><ChartNoAxesCombined className="size-6" /></span>
          <span className="font-display text-2xl font-semibold">SEO4WEB</span>
        </Link>
        <div className="auth-panel rounded-lg bg-card p-6 sm:p-8">
          <div className="auth-rule mb-6" />
          <p className="mb-2 text-xs font-semibold uppercase text-primary">SEO Command Center</p>
          <h1 className="auth-heading mb-2 text-3xl font-semibold">{mode === "signin" ? "Vitaj späť." : "Vytvor účet."}</h1>
          <p className="mb-7 text-sm text-muted-foreground">{mode === "signin" ? "Prihlás sa do svojho pracovného priestoru." : "Začni s prvým 30-dňovým plánom zadarmo."}</p>
          <Button variant="outline" onClick={google} disabled={busy} className="h-11 w-full">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3.1v2.6h3.2c1.9-1.8 3-4.4 3-7.6ZM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.2H3.1v2.7A10 10 0 0 0 12 22ZM6.4 13.7a6 6 0 0 1 0-3.4V7.6H3.1a10 10 0 0 0 0 8.8l3.3-2.7ZM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-8.9 5.6l3.3 2.7C7.2 7.9 9.4 6.1 12 6.1Z" /></svg>
            Pokračovať cez Google
          </Button>
          <div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-border" /><span className="text-xs text-muted-foreground">alebo emailom</span><div className="h-px flex-1 bg-border" /></div>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium">Email
              <input type="email" autoComplete="email" required placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium">Heslo
              <input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={6} placeholder="Minimálne 6 znakov" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <Button type="submit" disabled={busy} className="h-11 w-full">{busy ? "Prosím čakaj…" : mode === "signin" ? "Prihlásiť sa" : "Vytvoriť účet"} {!busy && <ArrowRight />}</Button>
          </form>
          <div className="mt-6 border-t border-border pt-4 text-center"><Button variant="link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="h-auto whitespace-normal text-sm">{mode === "signin" ? "Nemáš účet? Zaregistruj sa" : "Už máš účet? Prihlás sa"}</Button></div>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">SEO4WEB · Tvoj priestor pre organický rast</p>
      </div>
    </div>
  );
}
