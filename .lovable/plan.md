# Stav projektu SEO4WEB (Aktuálny stav & Plán)

## ✅ Dokončené a plne funkčné (Overené)

- **Kompletný modulárny systém:**
  - `/` — Blog Writer + SERP Lab (generovanie SEO článkov, reálny Google SERP náhľad s presnou slovenskou diakritikou, A/B/C varianty titulkov a meta popisov, Schema.org JSON-LD).
  - `/dashboard` — SEO Dashboard (Opportunity Radar, CTR Booster, KPI metriky, snapshoty, live skenovanie overených webov zo Search Console).
  - `/decay` — Content Decay Radar (porovnanie dvoch 90-dňových periód s paralelizáciou concurrency: 4, decay skóre, query recovery mapa, AI refresh plán, demo aj live režim).
  - `/audit` — SEO Audit domén (1–5 domén cez Semrush, content gap, quick wins, 30/60/90 dňový akčný plán).
  - `/plan` — 30-dňový obsahový plán (pillar/cluster štruktúra, search intent, limit 1. dňa zadarmo).
  - `/brief` — SEO Brief pre copywritera (SERP analýza, nadpisy H1-H3, E-E-A-T odporúčania).
  - `/raketa` — SEO Raketa (kontrola on-page faktorov a URL, serverové načítanie HTML, porovnanie s konkurentom, AI odporúčania).
  - `/history` — Centrálna história všetkých vygenerovaných výstupov s filtrami podľa typu.
  - `/login` — Prihlásenie a registrácia (Supabase Auth: email + Google OAuth).
- **Bezpečnosť & Multi-Tenancy:**
  - Multi-tenant izolácia Google Search Console v `gsc.server.ts` (`listUserVerifiedProperties`, `assertUserPropertyAccess`) zabraňujúca krížovému úniku dát medzi používateľmi.
  - Edge-safe Rate Limiter s LRU stropom `MAX_BUCKETS = 2000`, auto-pruningom a extrakciou klientskej IP z Cloudflare hlavičiek.
- **Slovenská NLP & Geografická inteligencia:**
  - Plná podpora všetkých krajských a okresných miest SR v `LOCATIONS`.
  - Odstránený hardkód Bratislavy; dynamická validácia podľa zámeru dopytu a e-shopových potrieb.
  - Kalibrovaný výpočet pixelových šírok fontu Arial (`textPixelWidth`) s precíznym zohľadnením úzkych a širokých znakov s diakritikou (`í`, `ĺ`, `ť`, `Á`, `Č`, `Ď`...).
- **Technická integrita:**
  - TypeScript kontrola (`tsc --noEmit` = 0 chýb).
  - Vitest automatické testy (`bunx vitest run` = 6 súborov, 32/32 testov úspešných).
  - Tailwind CSS v4 s Lightning CSS a sémantickými OKLCH tokenmi v `src/styles.css`.
  - TanStack Start v1 (React 19 + SSR + Vite 8).
  - Supabase PostgreSQL s Row Level Security (RLS) a zabezpečenými JWT server endpointmi.
  - Obojsmerná synchronizácia GitHub ↔ Lovable na vetve `main`.

## 🔄 Nasledujúce kroky (Roadmapa k 9 000 €+ MRR)

1. **Fáza 2 (Semrush Cache & Quota Guard):** Implementácia 7-dňovej medzivrstvy v databáze pre ukladanie snapshotov Semrush auditov, eliminácia chýb 429.
2. **Fáza 3 (Slovenský B2B Checkout & Paywall):** Integrácia Stripe s poľami pre IČO/DIČ/IČ DPH, webhook na generovanie slovenských faktúr (SuperFaktúra) a paywall brána nad 3 bezplatné URL.
3. **Fáza 4 (Whitelabel Agency Engine):** Serverový generátor klientskych PDF reportov s logom agentúry a vlastnými farbami pre balík 249 €/mesiac.
