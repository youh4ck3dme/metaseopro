import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Globe,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Key,
  Server,
  Sparkles,
} from "lucide-react";
import {
  listUserCmsConnections,
  saveUserCmsConnection,
  deleteUserCmsConnection,
  testConnectionBeforeSave,
  type SafeCmsConnection,
} from "@/lib/cms.functions";
import { normalizeWordPressEndpoint } from "@/lib/cms-publisher.server";

export function CmsConnectionsSection() {
  const [connections, setConnections] = useState<SafeCmsConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [siteUrl, setSiteUrl] = useState("");
  const [platform, setPlatform] = useState<"wordpress" | "custom_webhook">("wordpress");
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [wpUsername, setWpUsername] = useState("");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [seoPlugin, setSeoPlugin] = useState<"yoast" | "rank_math" | "core">("yoast");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load connections
  const fetchConnections = async () => {
    setLoading(true);
    try {
      const data = await listUserCmsConnections();
      setConnections(data);
    } catch (err) {
      console.error(err);
      toast.error("Nepodarilo sa načítať zoznam CMS integrácií.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchConnections();
  }, []);

  // Auto-fill API endpoint when siteUrl changes
  const handleSiteUrlChange = (value: string) => {
    setSiteUrl(value);
    if (platform === "wordpress" && value.trim()) {
      setApiEndpoint(normalizeWordPressEndpoint(value));
    }
  };

  const handleTestConnection = async () => {
    if (!apiEndpoint.trim()) {
      toast.error("Zadajte API endpoint.");
      return;
    }

    let credentials = "";
    if (platform === "wordpress") {
      if (!wpUsername.trim() || !wpAppPassword.trim()) {
        toast.error("Zadajte používateľské meno aj aplikačné heslo.");
        return;
      }
      credentials = `${wpUsername.trim()}:${wpAppPassword.trim()}`;
    } else {
      credentials = webhookToken.trim();
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await testConnectionBeforeSave({
        data: {
          apiEndpoint: apiEndpoint.trim(),
          credentials,
        },
      });

      setTestResult(res);
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Test spojenia zlyhal.";
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteUrl.trim()) {
      toast.error("Zadajte doménu alebo URL webu.");
      return;
    }

    let credentials = "";
    if (platform === "wordpress") {
      if (!wpUsername.trim() || !wpAppPassword.trim()) {
        toast.error("Zadajte používateľské meno aj aplikačné heslo.");
        return;
      }
      credentials = `${wpUsername.trim()}:${wpAppPassword.trim()}`;
    } else {
      credentials = webhookToken.trim() || "no_token";
    }

    setSaving(true);
    try {
      await saveUserCmsConnection({
        data: {
          siteUrl: siteUrl.trim(),
          platform,
          apiEndpoint: apiEndpoint.trim() || normalizeWordPressEndpoint(siteUrl),
          credentials,
          seoPlugin,
        },
      });

      toast.success("WordPress integrácia bola úspešne uložená!");
      setShowAddForm(false);
      setSiteUrl("");
      setWpUsername("");
      setWpAppPassword("");
      setWebhookToken("");
      setTestResult(null);
      void fetchConnections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chyba pri ukladaní integrácie.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, domain: string) => {
    if (!confirm(`Naozaj chcete odstrániť prepojenie s webom ${domain}?`)) return;
    setDeletingId(id);
    try {
      await deleteUserCmsConnection({ data: { id } });
      toast.success("Prepojenie bolo odstránené.");
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast.error("Nepodarilo sa odstrániť integráciu.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">WordPress & CMS Integrácie</h2>
          <p className="text-sm text-muted-foreground">
            Pripojte svoje WordPress weby a publikujte optimalizovaný Title, Meta Description a
            vygenerované články na 1 kliknutie.
          </p>
        </div>
        {!showAddForm && (
          <Button
            onClick={() => setShowAddForm(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
          >
            <Plus className="size-4" /> Pripojiť WordPress web
          </Button>
        )}
      </div>

      {/* Add New Connection Form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between border-b border-border/80 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 font-bold text-xs">
                <Globe className="size-4" />
              </span>
              <h3 className="font-semibold text-base">Pripojenie nového webu</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
              Zrušiť
            </Button>
          </div>

          <form onSubmit={handleSaveConnection} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Site URL */}
              <div className="space-y-1.5">
                <Label htmlFor="wp-site-url">Doména / URL webu *</Label>
                <Input
                  id="wp-site-url"
                  placeholder="https://mojweb.sk"
                  value={siteUrl}
                  onChange={(e) => handleSiteUrlChange(e.target.value)}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Zadajte adresu vášho webu vrátane https://
                </p>
              </div>

              {/* Platform */}
              <div className="space-y-1.5">
                <Label htmlFor="cms-platform">Typ integrácie</Label>
                <select
                  id="cms-platform"
                  value={platform}
                  onChange={(e) => {
                    const p = e.target.value as "wordpress" | "custom_webhook";
                    setPlatform(p);
                    if (p === "wordpress" && siteUrl) {
                      setApiEndpoint(normalizeWordPressEndpoint(siteUrl));
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="wordpress">WordPress (REST API v2)</option>
                  <option value="custom_webhook">Generický Webhook (JSON POST)</option>
                </select>
              </div>
            </div>

            {/* REST API Endpoint */}
            <div className="space-y-1.5">
              <Label htmlFor="wp-endpoint">API Endpoint *</Label>
              <Input
                id="wp-endpoint"
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
                placeholder="https://mojweb.sk/wp-json/wp/v2/posts"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Predvolená adresa pre WordPress REST API.
              </p>
            </div>

            {platform === "wordpress" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* WP Username */}
                  <div className="space-y-1.5">
                    <Label htmlFor="wp-user">WordPress Používateľské meno *</Label>
                    <Input
                      id="wp-user"
                      value={wpUsername}
                      onChange={(e) => setWpUsername(e.target.value)}
                      placeholder="admin alebo redaktor"
                      required
                    />
                  </div>

                  {/* SEO Plugin */}
                  <div className="space-y-1.5">
                    <Label htmlFor="wp-seo-plugin">Nainštalovaný SEO Plugin</Label>
                    <select
                      id="wp-seo-plugin"
                      value={seoPlugin}
                      onChange={(e) =>
                        setSeoPlugin(e.target.value as "yoast" | "rank_math" | "core")
                      }
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="yoast">Yoast SEO (uloží _yoast_wpseo_title a metadesc)</option>
                      <option value="rank_math">
                        Rank Math (uloží rank_math_title a description)
                      </option>
                      <option value="core">Základný WordPress (Titulok + Excerpt)</option>
                    </select>
                  </div>
                </div>

                {/* WP Application Password */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="wp-app-pass">WordPress Application Password *</Label>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Key className="size-3" /> Bezpečné aplikačné heslo
                    </span>
                  </div>
                  <Input
                    id="wp-app-pass"
                    type="password"
                    value={wpAppPassword}
                    onChange={(e) => setWpAppPassword(e.target.value)}
                    placeholder="xxxx yyyy zzzz wwww"
                    required
                  />
                  <div className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground space-y-1 border border-border/40">
                    <p className="font-medium text-foreground">
                      Ako získať Application Password vo WordPresse:
                    </p>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>Prihláste sa do WP Adminu ako administrátor alebo redaktor.</li>
                      <li>
                        Prejdite do <b>Používatelia (Users) &rarr; Profil</b>.
                      </li>
                      <li>
                        V dolnej časti v sekcii <b>Aplikačné heslá (Application Passwords)</b>{" "}
                        zadajte názov „SEO4WEB“ a kliknite na <i>Pridať nové aplikačné heslo</i>.
                      </li>
                      <li>Vygenerovaný 24-miestny kód skopírujte do tohto poľa.</li>
                    </ol>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="webhook-token">Bearer Token (voliteľné)</Label>
                <Input
                  id="webhook-token"
                  type="password"
                  value={webhookToken}
                  onChange={(e) => setWebhookToken(e.target.value)}
                  placeholder="secret_bearer_token"
                />
              </div>
            )}

            {/* Test result feedback */}
            {testResult && (
              <div
                className={`rounded-md p-3 text-xs flex items-center gap-2 border ${
                  testResult.ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <AlertCircle className="size-4 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Form Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/80">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
                className="gap-1.5"
              >
                {testing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Server className="size-3.5" />
                )}
                Otestovať spojenie
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddForm(false)}
                >
                  Zrušiť
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-3.5" />
                  )}
                  Uložiť pripojenie
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Connection List */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm">Načítavam pripojené weby…</p>
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-3">
          <Globe className="size-10 mx-auto text-muted-foreground/50" />
          <h3 className="font-semibold text-base">Zatiaľ nemáte pridaný žiadny WordPress</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Po pripojení webu budete môcť jedným kliknutím z Dashboardu alebo Blog Writera prepísať
            Title, Meta Description aj celý článok do vášho redakčného systému.
          </p>
          <Button
            onClick={() => setShowAddForm(true)}
            size="sm"
            className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
          >
            <Plus className="size-4" /> Pripojiť prvý WordPress
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3 relative overflow-hidden"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 font-bold text-xs">
                    <Globe className="size-4" />
                  </span>
                  <div>
                    <h4
                      className="font-semibold text-sm truncate max-w-[200px]"
                      title={conn.siteUrl}
                    >
                      {conn.siteUrl.replace(/^https?:\/\//, "")}
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      {conn.platform === "wordpress" ? "WordPress REST API" : "Custom Webhook"}
                    </p>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={deletingId === conn.id}
                  onClick={() => handleDelete(conn.id, conn.siteUrl)}
                  title="Odstrániť pripojenie"
                >
                  {deletingId === conn.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground pt-1 border-t border-border/40">
                <div className="flex justify-between">
                  <span>SEO plugin:</span>
                  <span className="font-medium text-foreground">
                    {conn.seoPlugin === "yoast"
                      ? "Yoast SEO"
                      : conn.seoPlugin === "rank_math"
                        ? "Rank Math"
                        : "Core"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Autentifikácia:</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Aktívna
                  </span>
                </div>
                <div className="flex justify-between truncate" title={conn.apiEndpoint}>
                  <span>Endpoint:</span>
                  <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[170px]">
                    {conn.apiEndpoint.replace(/^https?:\/\/[^/]+/, "")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
