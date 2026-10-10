import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SERP_LIMITS, buildCoverage, defaultCoverageGroups, textPixelWidth, titleWarnings, truncateToWidth } from "@/lib/opportunity";

function extract(md: string, re: RegExp): string {
  const m = md.match(re);
  return (m?.[1] ?? "").replace(/[*_`"]/g, "").trim();
}

export function SerpLab({ article, primary, secondary = [], url = "https://viandmo.com/" }: { article: string; primary: string; secondary?: string[]; url?: string }) {
  const h1 = extract(article, /^#\s+(.+)$/m);
  const [title, setTitle] = useState(() => extract(article, /meta\s*title[^:]*:\s*(.+)/i) || h1);
  const [desc, setDesc] = useState(() => extract(article, /meta\s*(?:description|popis)[^:]*:\s*(.+)/i));
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const kw = primary || h1;

  const t = truncateToWidth(title, device === "desktop" ? SERP_LIMITS.desktopTitle : SERP_LIMITS.mobileTitle);
  const d = truncateToWidth(desc, device === "desktop" ? SERP_LIMITS.desktopDesc : SERP_LIMITS.mobileDesc, 7);
  const warnings = useMemo(() => titleWarnings(title, { primary: kw }), [title, kw]);
  const coverage = useMemo(() => (kw ? buildCoverage(article, defaultCoverageGroups(kw, secondary)) : []), [article, kw, secondary]);
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  const color = { MISSING: "text-red-700", WEAK: "text-amber-700", GOOD: "text-emerald-700", "OVER-OPTIMIZED": "text-red-700" } as const;

  const copy = (s: string) => { void navigator.clipboard.writeText(s); toast.success("Skopírované"); };

  return (
    <section className="mx-auto mt-10 max-w-screen-xl px-6">
      <div className="rounded-[16px] bg-white p-6 ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-2xl">SERP Lab</h3>
          <div className="flex gap-1 text-xs">
            {(["desktop", "mobile"] as const).map((x) => (
              <button key={x} onClick={() => setDevice(x)} className={`rounded px-3 py-1 ${device === x ? "bg-neutral-900 text-neutral-50" : "bg-neutral-100"}`}>{x === "desktop" ? "Desktop" : "Mobil"}</button>
            ))}
          </div>
        </div>

        <div className={`mt-4 rounded-[12px] border border-neutral-200 p-4 ${device === "mobile" ? "max-w-[380px]" : "max-w-[640px]"}`}>
          <div className="text-xs text-neutral-600">{host}</div>
          <div className="text-lg text-[#1a0dab] leading-snug">{t.text || "— chýba title —"}</div>
          <div className="text-sm text-neutral-700">{d.text || "— chýba meta popis —"}</div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs text-neutral-500">Meta title · {Math.round(textPixelWidth(title))} px / {SERP_LIMITS.desktopTitle}
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-neutral-200 px-2 py-1.5 text-sm text-neutral-900" />
            <button onClick={() => copy(title)} className="mt-1 text-neutral-900 underline">Kopírovať title</button>
          </label>
          <label className="text-xs text-neutral-500">Meta popis · {desc.length} znakov (ideál 140–160)
            <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1 w-full rounded border border-neutral-200 px-2 py-1.5 text-sm text-neutral-900" />
            <button onClick={() => copy(desc)} className="mt-1 text-neutral-900 underline">Kopírovať popis</button>
          </label>
        </div>
        {(t.truncated || d.truncated || warnings.length > 0) && (
          <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">
            {t.truncated && <li>Title sa v tomto zobrazení skráti.</li>}
            {d.truncated && <li>Popis sa v tomto zobrazení skráti.</li>}
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}

        {coverage.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold">Pokrytie kľúčových slov v článku</h4>
            <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {coverage.map((c) => (
                <div key={c.group + c.term} className="flex justify-between rounded bg-neutral-50 px-2 py-1">
                  <span>{c.term}</span>
                  <span className={color[c.status]}>{c.status} ({c.count}) · {title.toLowerCase().includes(c.term.toLowerCase()) ? "v title" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-neutral-500">Pred publikovaním skontroluj text — appka nič nepublikuje automaticky.</p>
      </div>
    </section>
  );
}
