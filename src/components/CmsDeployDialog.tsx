import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Rocket,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Globe,
  FileEdit,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import {
  listUserCmsConnections,
  deployContentToCms,
  type SafeCmsConnection,
} from "@/lib/cms.functions";
import { extractSlugFromUrl } from "@/lib/cms-publisher.server";
import { Link } from "@tanstack/react-router";

export interface CmsDeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteUrl?: string;
  targetUrl?: string;
  initialTitle?: string;
  currentTitle?: string;
  initialMetaDescription?: string;
  currentMetaDescription?: string;
  initialContent?: string;
  postIdOrSlug?: string | number;
  status?: "draft" | "publish";
}

export function CmsDeployDialog({
  open,
  onOpenChange,
  siteUrl,
  targetUrl = "",
  initialTitle = "",
  currentTitle,
  initialMetaDescription = "",
  currentMetaDescription,
  initialContent,
  postIdOrSlug,
  status: initialStatus = "draft",
}: CmsDeployDialogProps) {
  const [connections, setConnections] = useState<SafeCmsConnection[]>([]);
  const [loadingConns, setLoadingConns] = useState(false);
  const [selectedConnId, setSelectedConnId] = useState<string>("");

  const [title, setTitle] = useState(initialTitle);
  const [metaDesc, setMetaDesc] = useState(initialMetaDescription);
  const [content, setContent] = useState(initialContent || "");
  const [targetPath, setTargetPath] = useState(targetUrl);
  const [status, setStatus] = useState<"draft" | "publish">(initialStatus);

  const [deploying, setDeploying] = useState(false);
  const [lastResult, setLastResult] = useState<{
    postUrl?: string;
    editUrl?: string;
    action?: string;
  } | null>(null);

  // Sync state when props change
  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setMetaDesc(initialMetaDescription);
      setContent(initialContent || "");
      setTargetPath(targetUrl);
      setLastResult(null);
    }
  }, [open, initialTitle, initialMetaDescription, initialContent, targetUrl]);

  // Load user's CMS connections
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingConns(true);

    listUserCmsConnections()
      .then((conns) => {
        if (!active) return;
        setConnections(conns);
        if (conns.length > 0) {
          // Pre-select matching connection based on siteUrl or targetUrl
          const normalized = (siteUrl || targetUrl).toLowerCase();
          const match =
            conns.find((c) =>
              normalized.includes(c.siteUrl.toLowerCase().replace(/^https?:\/\//, "")),
            ) || conns[0]!;
          setSelectedConnId(match.id);
        }
      })
      .catch((err) => {
        console.error("Failed to load CMS connections:", err);
      })
      .finally(() => {
        if (active) setLoadingConns(false);
      });

    return () => {
      active = false;
    };
  }, [open, siteUrl, targetUrl]);

  const selectedConn = connections.find((c) => c.id === selectedConnId);

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConnId) {
      toast.error("Vyberte prosím cieľový WordPress web.");
      return;
    }

    setDeploying(true);
    setLastResult(null);

    try {
      const rawResult = await deployContentToCms({
        data: {
          connectionId: selectedConnId,
          siteUrl: selectedConn?.siteUrl,
          targetUrl: targetPath.trim() || undefined,
          postIdOrSlug: postIdOrSlug || extractSlugFromUrl(targetPath) || undefined,
          title: title.trim() || undefined,
          metaDescription: metaDesc.trim() || undefined,
          content: content.trim() || undefined,
          status,
        },
      });

      const result = rawResult as import("@/lib/cms-publisher.server").PublishResult;

      setLastResult({
        postUrl: result.postUrl,
        editUrl: result.editUrl,
        action: result.action,
      });

      toast.success(
        status === "publish"
          ? "Zmeny boli úspešne publikované naživo do WordPressu!"
          : "Koncept bol úspešne vytvorený / aktualizovaný vo WordPresse!",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chyba pri nasadzovaní na web.");
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <Rocket className="size-4" />
            </span>
            <div>
              <DialogTitle className="text-xl">1-Click CMS Nasadenie</DialogTitle>
              <DialogDescription>
                Nasaďte optimalizovaný Title, Meta Description a článok priamo do WordPressu.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loadingConns ? (
          <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm">Načítavam pripojené WordPress weby…</p>
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-lg border border-border/80 bg-muted/30 p-6 text-center space-y-3">
            <Globe className="size-10 mx-auto text-muted-foreground/60" />
            <h3 className="font-semibold text-base">Zatiaľ nemáte pripojený žiadny WordPress</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Pre automatické nasadzovanie na 1 kliknite pripojte svoj WordPress web pomocou REST
              API a Application Passwords.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onOpenChange(false)}
            >
              <Link to="/settings/agency">
                Otvoriť nastavenia CMS integrácií <ArrowRight className="size-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleDeploy} className="space-y-4 pt-2">
            {/* Connection Picker */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="cms-conn">Cieľový web (WordPress REST API)</Label>
                <Link
                  to="/settings/agency"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  onClick={() => onOpenChange(false)}
                >
                  Spravovať weby <ExternalLink className="size-3" />
                </Link>
              </div>
              <select
                id="cms-conn"
                value={selectedConnId}
                onChange={(e) => setSelectedConnId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.siteUrl} (
                    {c.seoPlugin === "yoast"
                      ? "Yoast SEO"
                      : c.seoPlugin === "rank_math"
                        ? "Rank Math"
                        : "Core"}
                    )
                  </option>
                ))}
              </select>
            </div>

            {/* Target URL / Path */}
            <div className="space-y-1.5">
              <Label htmlFor="target-path">Cieľová URL alebo Slug stránky</Label>
              <Input
                id="target-path"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder="napr. /blog/ako-vybrat-batoh alebo https://mojweb.sk/kontakt"
              />
              <p className="text-[11px] text-muted-foreground">
                Zadajte URL existujúceho článku na aktualizáciu, alebo slug nového článku.
              </p>
            </div>

            {/* Title with diff comparison */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="cms-title">Optimalizovaný Meta Title</Label>
                <span className="text-[11px] text-muted-foreground">
                  {title.length} / 60 znakov
                </span>
              </div>
              {currentTitle && currentTitle !== title && (
                <div className="rounded bg-muted/60 p-2 text-xs text-muted-foreground space-y-0.5 border border-border/40">
                  <span className="font-medium text-destructive line-through mr-1">Starý:</span>
                  {currentTitle}
                </div>
              )}
              <Input
                id="cms-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Pútavý a optimalizovaný SEO titulok"
              />
            </div>

            {/* Meta Description with diff comparison */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="cms-meta">Meta Description</Label>
                <span
                  className={`text-[11px] ${
                    metaDesc.length > 160 ? "text-amber-500 font-medium" : "text-muted-foreground"
                  }`}
                >
                  {metaDesc.length} / 155 znakov
                </span>
              </div>
              {currentMetaDescription && currentMetaDescription !== metaDesc && (
                <div className="rounded bg-muted/60 p-2 text-xs text-muted-foreground space-y-0.5 border border-border/40">
                  <span className="font-medium text-destructive line-through mr-1">Starý:</span>
                  {currentMetaDescription}
                </div>
              )}
              <Textarea
                id="cms-meta"
                rows={2}
                value={metaDesc}
                onChange={(e) => setMetaDesc(e.target.value)}
                placeholder="Stručný a klikateľný popis stránky pre Google výsledky"
              />
            </div>

            {/* Content preview if article present */}
            {content && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="cms-content">Obsah článku (HTML / Markdown)</Label>
                  <span className="text-[11px] text-muted-foreground">
                    ~{content.split(/\s+/).filter(Boolean).length} slov
                  </span>
                </div>
                <Textarea
                  id="cms-content"
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            )}

            {/* Publishing Mode */}
            <div className="rounded-lg border border-border p-3 bg-card space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Režim nasadenia
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border p-2 text-xs font-medium transition-all ${
                    status === "draft"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="deployStatus"
                    value="draft"
                    checked={status === "draft"}
                    onChange={() => setStatus("draft")}
                    className="sr-only"
                  />
                  <FileEdit className="size-3.5" /> Koncept (Draft)
                </label>

                <label
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border p-2 text-xs font-medium transition-all ${
                    status === "publish"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="deployStatus"
                    value="publish"
                    checked={status === "publish"}
                    onChange={() => setStatus("publish")}
                    className="sr-only"
                  />
                  <Rocket className="size-3.5" /> Publikovať naživo (Publish)
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {status === "draft"
                  ? "Odporúčané: Článok sa uloží ako koncept vo WordPress administrácii na finálne schválenie."
                  : "Pozor: Zmeny sa okamžite zverejnia na ostrom webe."}
              </p>
            </div>

            {/* Last Result Box */}
            {lastResult && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span>Úspešne nasadené do WordPressu!</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {lastResult.editUrl && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <a href={lastResult.editUrl} target="_blank" rel="noopener noreferrer">
                        Upraviť v WP Admin <ExternalLink className="size-3 ml-1" />
                      </a>
                    </Button>
                  )}
                  {lastResult.postUrl && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <a href={lastResult.postUrl} target="_blank" rel="noopener noreferrer">
                        Zobraziť článok <ExternalLink className="size-3 ml-1" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border/80">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Zavrieť
              </Button>
              <Button
                type="submit"
                disabled={deploying}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              >
                {deploying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Nasadzujem…
                  </>
                ) : (
                  <>
                    <Rocket className="size-4" />
                    {status === "publish" ? "Nasaď naživo" : "Odoslať ako koncept"}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
