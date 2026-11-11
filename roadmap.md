# SEO4WEB — Technická a produktová roadmapa

## 1. Technická integrita & Bezpečnosť (Hotovo ✅)

- [x] Odstránený hardkódovaný reťazec Bratislava z Opportunity Engine; dynamická podpora 79 okresných a krajských miest SR.
- [x] Multi-tenant ochrana a striktná izolácia Google Search Console properties (`listUserVerifiedProperties`, `assertUserPropertyAccess`).
- [x] Presná pixelová kalkulácia Google SERP náhľadov pre slovenskú diakritiku (`textPixelWidth`).
- [x] Pamäťovo bezpečný Rate Limiter s LRU auto-pruningom a extrakciou klientskej IP na Cloudflare Workers.
- [x] Paralelizované dopytovanie v Content Decay Radare (`concurrency: 4`) pre elimináciu timeoutov.
- [x] 100% priechodnosť testovacej suity a nulové TypeScript chyby.

## 2. Výkon & Zníženie API nákladov (Hotovo ✅)

- [x] 7-dňová perzistentná cache pre Semrush audity v Supabase (`semrush_domain_cache`).
- [x] Predchádzanie prekročeniu kvóty Semrush API (`ERROR 134`) a automatický circuit breaker / návrat stale dát.
- [x] L1 pamäťová cache pre okamžité znovunačítanie v rámci edge izolátu.
- [x] Automatizované testy pre TTL, write-through a fallback mechanizmy.

## 3. Monetizácia & Slovenský B2B Onboarding (Hotovo ✅)

- [x] 3-stupňová cenotvorba (Free, Pro 39 € / mes., Agency 89 € / mes.) s presným vymedzením limitov.
- [x] Supabase schéma pre predplatné (`subscriptions`) s RLS politikami.
- [x] Slovenská a česká validácia firemných fakturačných údajov (`src/lib/slovak-billing.ts`):
  - `isValidICO()` (vážený modulo 11 kontrolný algoritmus pre 8-miestne IČO)
  - `isValidDIC()` (10-miestne číslo začínajúce na 10, 20 alebo 21 deliteľné 11)
  - `isValidICDPH()` (predpona SK s formátom platného DIČ)
- [x] Stripe Checkout serverová funkcia (`createCheckoutSessionServer`) s prenosom firemných metadát a daňových polí.
- [x] Bezpečný Stripe Webhook (`/api/public/stripe-webhook`) s overením podpisov (`stripe-signature`), idempotenciou a prípravou pre SuperFaktúru (20% DPH vs. EU Reverse Charge).
- [x] Vizuálne Paywall modály (`<PaywallModal />`) integrované na kľúčových trasách (`/dashboard`, `/decay`, `/audit`).

## 4. Whitelabel Agency Engine & PDF Export (Hotovo ✅)

- [x] Supabase tabuľka `agency_profiles` s kompletnou RLS ochranou pre používateľov.
- [x] Nastavenia identity agentúry na `/settings/agency`:
  - Nahratie vlastného loga agentúry (URL / Storage).
  - Výber primárnej farby brandingu (HEX).
  - Kontaktné údaje a text pätičky.
  - Živý náhľad hlavičky reportu.
- [x] Profesionálny modál klientskeho reportu (`<ClientReportModal />`):
  - Titulná strana s logom agentúry a 90-dňovým obdobím.
  - Executive Summary s rastovými metrikami a celkovým SEO Health Indexom.
  - Top víťazi mesiaca (rastúce kľúčové slová a URL).
  - Opportunity Radar (Striking Distance pozície 4–15).
  - Zrealizované overené optimalizácie (`seo_experiments`).
  - Akčný plán na ďalší mesiac.
  - **Zdieľateľný webový odkaz na report:** Generovanie URL-safe tokenov a kopírovanie odkazu priamo do schránky (`generateShareableReportLink`).
- [x] Tlačové formátovanie (`@media print`):
  - Automatické vygenerovanie čistého PDF na 1 kliknutie cez natívny tlačový dialóg prehliadača.
  - Striktné stránkovanie A4 (`break-inside: avoid`).
  - 100% Whitelabel vzhľad bez akýchkoľvek odkazov na SEO4WEB.

## 5. Automatizované Testy Integrity & E2E (Hotovo ✅)

- [x] **Integrita premenných & tajomstiev:** `.env` obsahuje len verejné frontend kľúče, žiadne privátne tokeny.
- [x] **Git ochrana:** `.env.local` a `node_modules` sú v `.gitignore`.
- [x] **Vzorová konfigurácia:** `.env.example` pokrýva všetky potrebné premenné.
- [x] **Architektúra TanStack Start:** Všetky serverové funkcie využívajú výhradne `.validator()`.
- [x] **Router integrita:** Žiadne nepovolené importy z `react-router-dom`.
- [x] **Databázová bezpečnosť:** Každá tabuľka vo všetkých migráciách má zapnuté `ENABLE ROW LEVEL SECURITY`.
- [x] **Kompletná testovacia sada:** 61 testov v 11 testovacích suitách (100% PASS).
- [x] **Statická analýza & Linting:** 0 chýb v ESLint a TypeScript (`tsc --noEmit`).

## 6. AI System Prompts & FinTech Polish (Hotovo ✅)

- [x] **EÚ VIES Overovač IČ DPH (`verifyViesVat`):** Reálny dopyt na VIES REST API Európskej komisie s graceful fallbackom pri výpadku.
- [x] **AI Prompts Polish:**
  - `ARTICLE_SYSTEM_PROMPT`: E-E-A-T štandardy, striktné vokalizované slovenské predložky (so/vo/ku/zo), Schema.org graph validita, anti-hallucination pravidlá.
  - `AUDIT_SYSTEM_PROMPT`: Analýza lokálneho intentu, Semrush dáta bez halucinácií, E-E-A-T autorita.
  - `BRIEF_SYSTEM_PROMPT`: Entity a LSI termíny, vylúčenie generickej vaty, copywriter checklist.
  - `DECAY_SYSTEM_PROMPT`: Presný recovery plán pre stratené vyhľadávacie frázy.
  - `RAKETA_SYSTEM_PROMPT` a `CONTENT_PLAN_SYSTEM_PROMPT`: Technická on-page hierarchia a 30-dňové klastrovanie.

---

## 7. Nasledujúce vylepšenia (Plánované 🚀)

- [x] Aplikovať chýbajúce tabuľky cache, predplatného a agentúry s grantmi a RLS.
- [x] Zjednotiť navigáciu existujúcich nástrojov a zobraziť aktuálny balík používateľa.
- [x] Overiť uloženie profilu agentúry a navigáciu na počítači aj mobile.
- [ ] **SuperFaktúra / Fakturoid API konektor:** Priame automatické vystavenie a odoslanie slovenskej faktúry na e-mail klienta po úspešnej Stripe platbe.
- [ ] **WordPress REST API exportér:** Automatické publikovanie a aktualizácia meta značiek priamo do Yoast / RankMath na klientovom webe.
