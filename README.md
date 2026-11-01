# SEO4WEB — AI SEO Command Center

SEO4WEB je slovenská SEO platforma, ktorá spája reálne dáta z Google Search Console, Semrush a AI na jednom mieste: nachádza príležitosti, odhaľuje prepady návštevnosti a pripravuje obsah na schválenie človekom.

## Moduly

| Stránka | Modul | Čo robí |
| --- | --- | --- |
| `/` | Blog Writer + SERP Lab | Článok z témy alebo z dát Search Console, náhľad v Google (desktop/mobil), varianty A/B/C pre title a meta popis, kontrola pokrytia kľúčových slov, Schema.org JSON-LD |
| `/dashboard` | SEO Dashboard | KPI (kliky, zobrazenia, pozícia, Health index), uložené snapshoty, porovnanie dvoch snapshotov, výpis všetkých URL a dopytov, Opportunity Radar, CTR Booster |
| `/decay` | Content Decay Radar | Porovnanie posledných 90 dní s predchádzajúcimi 90 dňami, decay skóre, analýza dopytov, AI plán obnovy; demo aj live režim |
| `/audit` | SEO Audit | Analýza 1–5 domén cez Semrush, content gap, quick wins, plán na 30/60/90 dní |
| `/plan` | 30-dňový plán | Obsahový plán s pillar/cluster štruktúrou a search intentom (prvý deň zdarma) |
| `/brief` | SEO Brief | Zadanie pre redaktora: SERP analýza, štruktúra nadpisov, E-E-A-T |
| `/raketa` | Raketa | Kontrola URL, načítanie HTML na serveri, porovnanie s konkurenciou, AI stratégia |
| `/history` | História | Uložené výstupy všetkých nástrojov |
| `/login` | Prihlásenie | Účet cez e-mail a Google |

## Opportunity Engine

Logika v `src/lib/opportunity.ts` (testy v `src/lib/opportunity.test.ts`):

- stránka sa započíta pri **≥ 20 zobrazeniach alebo ≥ 1 kliku**,
- rozpoznanie zámeru hľadania a odporúčaný typ stránky,
- skóre príležitosti a kategórie (Quick win, Striking distance, Zero clicks, Protect winner…),
- detekcia kanibalizácie a návrhy interných odkazov,
- odhad skrátenia title/popisu v Google podľa šírky v pixeloch,
- štruktúrované dáta iba z reálnych údajov (chýbajúce sú označené ako „potrebný vstup"),
- vyhodnotenie zmien (`seo_experiments`).

**Pravidlá obsahu:** žiadne vymyslené rankingy, recenzie, ceny ani adresy, žiadny keyword stuffing, doorway stránky ani automatické publikovanie bez ľudskej kontroly.

## Technológie

- **TanStack Start v1** (React 19, SSR, TanStack Router + Query), Vite 7, beh na Cloudflare Workers
- **Tailwind CSS v4** so sémantickými tokenmi v `src/styles.css`, Radix UI / shadcn, fonty Outfit + Figtree
- **Lovable Cloud** — databáza s RLS, autentifikácia, server funkcie
- **Integrácie:** Google Search Console (connector), Semrush, Lovable AI Gateway

## Štruktúra

```text
src/
  routes/          stránky + api/* (chránené API s JWT, Zod a rate limitmi)
  components/      AppHeader, OpportunityRadar, SerpLab, ui/*
  lib/             gsc.server, semrush.server, snapshots.server, opportunity,
                   prompty (*-prompt.ts), decay-*, raketa-*, stream-sse
  integrations/    supabase (generované), lovable
supabase/migrations/  schéma databázy
```

## Databáza

- `profiles`, `content_plan_usage` — účty a free-day limit plánu
- `generated_outputs` — história výstupov
- `seo_snapshots` — uložené live skeny (decay / audit / gsc_overview)
- `seo_experiments` — sledovanie SEO zmien pred/po

Všetky tabuľky majú RLS — každý používateľ vidí iba vlastné dáta.

## Lokálny vývoj

```bash
bun install
bun dev            # http://localhost:8080
bunx vitest run    # testy
bun run lint
```

## Premenné prostredia

Do gitu patrí iba `.env.example`. Súbor `.env` obsahuje len verejné hodnoty (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`).
Tajné kľúče (`LOVABLE_API_KEY`, `SEMRUSH_API_KEY`, `GOOGLE_SEARCH_CONSOLE_API_KEY`) sú uložené iba v Lovable Cloud secrets.

## Synchronizácia

Lovable ↔ GitHub (`youh4ck3dme/metaseopro`, vetva `main`) ↔ lokálny editor. Pred lokálnou prácou vždy `git pull --rebase`.

## Nasadenie

Publikovaná verzia: https://seo4web.lovable.app
