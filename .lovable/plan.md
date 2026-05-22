
## Písmo — AI SEO blog writer (SK)

Postavím jednostránkovú appku podľa vybraného dizajnu "Editorial content studio". Používateľ zadá 2-3 vety o téme, appka cez Lovable AI Gateway vygeneruje dlhý SEO-optimalizovaný článok v slovenčine podľa tvojho expert promptu, s živým streamovaním textu.

### Funkcie
- Hero + textarea pre 2-3 vety, tlačidlo **Generovať článok**
- Sidebar "Ako Písmo pracuje" + ilustračný obrázok
- Hlavné plátno článku — streamuje markdown text token po tokene (Meta Title, Meta Description, H1, H2/H3, FAQ, záver, CTA)
- Indikátor "Generuje sa..." + možnosť **Zastaviť**
- Floating action bar dole: **Regenerovať**, **Kopírovať**, **Stiahnuť .md** (aktívne až po dokončení)
- Empty state pred prvým generovaním (skrytá output sekcia)
- Toast notifikácie pre chyby (429 rate limit, 402 credits)

### Technické detaily
- **Lovable Cloud** povolím — potrebné pre AI Gateway (LOVABLE_API_KEY)
- **Backend**: TanStack Start server route `src/routes/api/generate-article.ts` (POST, streaming SSE). Server route, nie serverFn, lebo potrebujeme streamovať response body priamo
- **Model**: `google/gemini-3-flash-preview` (default, dobrá kvalita pre long-form SK obsah)
- **System prompt**: tvoj expert SEO prompt zabudovaný na serveri (klient pošle len 2-3 vety)
- **Frontend**: SSE parser (depth-tracking, podľa AI Gateway guide), progresívne renderovanie markdown cez `react-markdown` + `remark-gfm`
- **Štruktúra súborov**:
  - `src/routes/index.tsx` — celá UI appky
  - `src/routes/api/generate-article.ts` — streaming endpoint
  - `src/lib/article-prompt.ts` — system prompt (SEO expert)
  - `src/lib/stream-article.ts` — frontend SSE helper
- **Design tokeny**: pridám `--font-serif: Instrument Serif`, `--font-sans: Inter`, neutral paleta do `src/styles.css` (oklch). Tailwind triedy `neutral-*` zostávajú, accent farba `#2563eb` pridaná ako token
- **Obrázok**: vygenerujem minimalistický workspace shot do sidebar placeholderu
- **Markdown rendering**: `react-markdown` + `remark-gfm` + tailwind typography (`@tailwindcss/typography`)
- **SEO meta**: title "Písmo — AI SEO blog writer", description v slovenčine, `lang="sk"` na `<html>`
- **Download .md** generuje súbor z plného textu článku, **Kopírovať** dá obsah do clipboardu

### Out of scope (môžeme pridať neskôr)
- História / "Moja knižnica" — link v navigácii bude zatiaľ neaktívny
- Auth / účty
- Ukladanie článkov do DB

Po schválení postavím všetko v jednom kroku.
