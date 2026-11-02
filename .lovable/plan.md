# Stav projektu SEO4WEB (Aktuálny stav & Plán)

## ✅ Dokončené a plne funkčné (Overené)
- **Kompletný modulárny systém:**
  - `/` — Blog Writer + SERP Lab (generovanie SEO článkov, SERP náhľad, A/B/C varianty titulkov a meta popisov, Schema.org JSON-LD).
  - `/dashboard` — SEO Dashboard (Opportunity Radar, CTR Booster, KPI metriky, snapshoty, live skenovanie overených webov).
  - `/decay` — Content Decay Radar (porovnanie 90-dňových periód, decay skóre, query recovery mapa, AI refresh plán, demo aj live režim).
  - `/audit` — SEO Audit domén (1–5 domén cez Semrush, content gap, quick wins, 30/60/90 dňový akčný plán).
  - `/plan` — 30-dňový obsahový plán (pillar/cluster štruktúra, search intent, limit 1. dňa zadarmo).
  - `/brief` — SEO Brief pre copywritera (SERP analýza, nadpisy H1-H3, E-E-A-T).
  - `/raketa` — SEO Raketa (kontrola on-page faktorov a URL, serverové načítanie HTML, porovnanie s konkurentom, AI odporúčania).
  - `/history` — Centrálna história všetkých vygenerovaných výstupov s filtrami podľa typu.
  - `/login` — Prihlásenie a registrácia (Supabase Auth: email + Google OAuth).
- **Technická integrita:**
  - TypeScript kontrola (`tsc --noEmit` = 0 chýb).
  - Vitest unit testy (`bunx vitest run` = 4/4 testy prešli úspešne).
  - Tailwind CSS v4 s Lightning CSS a sémantickými OKLCH tokenmi v `src/styles.css`.
  - TanStack Start v1 (React 19 + SSR + Vite 8).
  - Supabase databáza s Row Level Security (RLS) a zabezpečenými JWT server endpointmi.
  - Obojsmerná synchronizácia GitHub ↔ Lovable na vetve `main`.

## 🔄 Nasledujúce kroky & Vylepšenia
1. End-to-end overenie živých Search Console a Semrush dát pre prihlásených používateľov s aktívnymi kľúčmi.
2. Rozšírenie automatických testov pre `decay-analyze.server.ts` a `site-analyze.server.ts`.
3. Priebežné sledovanie a vyhodnocovanie experimentov v tabuľke `seo_experiments`.
