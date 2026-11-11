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

## 7. UI/UX Navigácia & Databázová Integrita (Hotovo ✅)

- [x] **Konsolidovaná idempotentná migrácia (`supabase/migrations/20261111000000_consolidated_missing_tables.sql`):** Transakčné nasadenie tabuliek `agency_profiles`, `subscriptions` a `semrush_domain_cache` s RLS ochranou a idempotentnými triggermi.
- [x] **Plná typová bezpečnosť Supabase (`src/integrations/supabase/types.ts`):** 100% zosúladenie PostgreSQL schémy s TypeScriptom a úplné odstránenie provizórnych `as never` pretypovaní.
- [x] **Nová modulárna navigácia (`src/components/AppHeader.tsx`):**
  - **SEO Nástroje dropdown:** Dashboard, SEO Raketa, Decay Radar, SEO Audit, Blog Writer s popismi a Lucide ikonami.
  - **Obsah & Taktika dropdown:** Content Plan, SEO Brief, História vygenerovaných výstupov.
  - **Agentúra dropdown:** Whitelabel nastavenia (`/settings/agency`), klientske PDF reporty.
  - **Plan Pill / Odznak predplatného:** Dynamické zobrazenie aktuálneho stavu (`Free`, `Pro`, `Agency`) priamo v hlavičke.
  - **Rýchla akcia "Cenník / Upgrade":** Jedným kliknutím otvára vložený `<PaywallModal />`.
  - **Používateľské menu:** Zobrazenie e-mailu, odkazu na agentúrne nastavenia a bezpečné odhlásenie.
  - **Responzívny Sheet drawer:** Prepracované mobilné a tabletové menu s kompletnou kategorizáciou.

---

## 8. Nasledujúce vylepšenia (Plánované 🚀)

- [x] Aplikovať chýbajúce tabuľky cache, predplatného a agentúry s grantmi a RLS.
- [x] Zjednotiť navigáciu existujúcich nástrojov a zobraziť aktuálny balík používateľa.
- [x] Overiť uloženie profilu agentúry a navigáciu na počítači aj mobile.
- [x] **SuperFaktúra API konektor & Automatická B2B fakturácia (`src/lib/invoicing.server.ts`):**
  - Automatické vystavenie daňového dokladu po udalosti `checkout.session.completed` cez SuperFaktúra REST API (`/invoices/create`).
  - Automatické doručenie faktúry v PDF formáte na e-mail klienta cez `/invoices/sendInvoiceEmail`.
  - Daňový algoritmus pre SR a EÚ: 20% DPH pre tuzemské subjekty vs. 0% Reverse Charge (§ 69 ods. 3 zákona o DPH) pre zahraničné firmy s overeným IČ DPH.
  - Graceful fallback s detailným mock payloadom pri absencii produkčných kľúčov.
  - Perzistencia čísla faktúry a odkazu na stiahnutie (`last_invoice_number`, `last_invoice_url`) v tabuľke `subscriptions`.
  - UI sekcia **„Fakturačné údaje a história platieb“** na `/settings/agency` a `/dashboard` s okamžitou validáciou IČO, DIČ, IČ DPH a tlačidlom na stiahnutie PDF faktúry.
- [x] **WordPress REST API & 1-Click CMS konektor (`src/lib/cms-publisher.server.ts`):**
  - Plná integrácia WordPress REST API v2 (`/wp-json/wp/v2/posts`) a Custom Webhookov.
  - Zápis SEO meta polí pre **Yoast SEO** (`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`) aj **Rank Math** (`rank_math_title`, `rank_math_description`).
  - Vyhľadávanie existujúcich príspevkov podľa slugu alebo ID s automatickou aktualizáciou namiesto duplikovania.
  - Zabezpečená schéma `cms_connections` v Supabase s RLS politikami (`auth.uid() = user_id`).
  - Interaktívny dialóg `<CmsDeployDialog />` na Dashboarde (CTR Booster, Opportunity Radar) a v Blog Writeri (`/`, `/brief`).
  - Správa a overovanie spojenia v `/settings/agency` na novej záložke **CMS Integrácie**.
- [x] **Whitelabel Klientsky PDF Report Generator (`src/lib/pdf-report.ts`):**
  - Reprezentatívny klientsky audit s dynamickou hlavičkou, logom a primárnou farbou z `agency_profiles`.
  - 4 súhrnné KPI karty (SEO Health Index, organické kliky, impresie, priemerná pozícia s medzimesačnou deltou).
  - Prehľad 5 najväčších prepadov z Decay Radaru s odporúčanými akčnými krokmi a Striking Distance príležitosti.
  - Tlačidlo **„Stiahnuť klientsky report (PDF)“** priamo na Dashboarde pre zvolený web.
- [x] **Automatizovaný nočný Decay Alerting (`/api/public/cron-decay-alerts`):**
  - Server endpoint zabezpečený cez `CRON_SECRET` a IP rate limiting.
  - Automatická detekcia URL s prepadom klikov > 25 % oproti predchádzajúcemu obdobiu.
  - Responzívna HTML e-mailová šablóna s prehľadom postihnutých URL a preklikom do aplikácie cez Resend API.
- [x] **Odstránenie 4 bezpečnostných varovaní (Security Hardening):**
  - Migrácia `20261111030000_security_hardening.sql`: zapnuté a vynútené RLS na všetkých tabuľkách.
  - Odobratie verejných/anon oprávnení na používateľské tabuľky (`REVOKE ALL`).
  - Zavedená SSRF ochrana v `cms-publisher.server.ts`.
  - Rate limiting a obmedzenie veľkosti payloadu na webhookoch.
- [x] **Produkčný SEO & Launch Checklist:**
  - Vytvorený `public/robots.txt` a dynamická `sitemap.xml` v `src/routes/api/public/sitemap.ts`.
  - Doplnené OpenGraph a Twitter karty, canonical meta tag a sémantický popis v `src/routes/__root.tsx`.
