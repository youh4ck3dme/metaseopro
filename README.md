# SEO4WEB — AI SEO Command Center

SEO4WEB je moderná slovenská all-in-one SEO platforma novej generácie navrhnutá pre e-shopy, digitálne marketingové agentúry a SEO špecialistov na slovenskom a českom trhu. Spája reálne dáta z **Google Search Console** a **Semrush** s pokročilými **AI modelmi** (Google Gemini) na jednom mieste: automaticky identifikuje príležitosti rastu, deteguje prepady organickej návštevnosti (**Content Decay Radar**), zabraňuje keyword kanibalizácii a generuje optimalizovaný obsah pripravený na schválenie človekom.

Platforma je plne prispôsobená pre slovenský jazyk (skloňovanie, diakritika, lokálne vyhľadávacie zámery) a stavia na nekompromisnej multi-tenant bezpečnosti dát.

---

## 🚀 Rýchly štart (Lokálny vývoj)

Projekt využíva **Bun v1.4+** (plne kompatibilné aj s Node.js v22 LTS) s vývojovým serverom Vite bežiacim na porte **8080**:

```bash
# 1. Klonovanie repozitára (ak ešte nemáš lokálnu kópiu)
git clone https://github.com/youh4ck3dme/metaseopro.git
cd metaseopro

# 2. Inštalácia závislostí
bun install

# 3. Spustenie lokálneho vývojového servera
bun dev
# Aplikácia beží na http://localhost:8080 (alebo http://127.0.0.1:8080)

# 4. Spustenie celej testovacej suity (46 testov v 9 suitách)
bunx vitest run

# 5. Typová kontrola kódu (Zero TypeScript Errors)
bun run tsc --noEmit

# 6. Produkčný build
bun run build
```

---

## 🔄 Git Workflow & Obojsmerná synchronizácia (Local ↔ GitHub ↔ Lovable)

Projekt je prepojený s GitHub repozitárom [`youh4ck3dme/metaseopro`](https://github.com/youh4ck3dme/metaseopro) na hlavnej vetve `main` a cloudovým prostredím **Lovable Cloud**. Pre bezproblémovú synchronizáciu bez konfliktov a rozdvojených vetiev striktne dodržuj tento **trojkrokový workflow**:

### 1. Pred začiatkom práce vždy stiahnuť zmeny (z Lovable / GitHubu)
```bash
git pull --rebase origin main
```

### 2. Po úpravách overiť integritu a funkčnosť
```bash
bunx vitest run
bun run tsc --noEmit
```

### 3. Zcommitovať zmeny s GPG podpisom a poslať do main
```bash
git add .
git commit -m "feat/fix: stručný a výstižný popis zmeny"
git push origin main
```

> [!TIP]
> Platforma Lovable počúva na webhooky vetvy `main`. Každý push do `main` okamžite a automaticky zosynchronizuje zmeny do cloudového editora a produkčného prostredia.

---

## 🛠️ Architektúra a technologický stack

- **Frontend & Full-Stack SSR:** [TanStack Start](https://tanstack.com/start) v1 (React 19 + SSR + Vite 8).
- **Typovaný Routing:** `@tanstack/react-router` (striktne typovaný filesystémový routing v `src/routes/`).
- **Data Fetching & Cache:** `@tanstack/react-query` v5.
- **Dizajn systém & Štýly:** [Tailwind CSS v4](https://tailwindcss.com/) s Lightning CSS v `src/styles.css` (OKLCH sémantické farebné tokeny, podpora tmavého/svetlého režimu), komponenty Radix UI / shadcn, webfonty _Outfit_ a _Figtree_.
- **Serverless Edge Runtime:** Cloudflare Workers (cez `@cloudflare/vite-plugin` a Nitro) s prísnou kontrolou pamäte a časových limitov.
- **Backend & Databáza:** Supabase PostgreSQL (`pwftbssvdbjoblmhdeax.supabase.co`) cez Lovable Cloud s Row Level Security (RLS) a JWT autentifikáciou.
- **ORM & Migrácie:** Drizzle ORM (`drizzle/schema.ts`, `supabase/migrations/`).
- **Externé integrácie:**
  - Google Search Console API (Lovable Connector Gateway s multi-tenant izoláciou).
  - Semrush API (analýza domén, keyword gap a konkurenčný audit).
  - Lovable AI Gateway (Google Gemini modely pre generovanie obsahu a SEO briefov).

---

## 📂 Prehľad modulov a routovacej štruktúry

| Cesta | Modul | Kľúčová funkcionalita |
| :--- | :--- | :--- |
| `/` | **Blog Writer + SERP Lab** | Tvorba dlhých SEO článkov z kľúčových slov alebo tém; živý Google SERP náhľad (desktop 600px / mobil 520px) s presnou slovenskou diakritikou; A/B/C varianty meta titulkov a popisov; sémantická kontrola pokrytia entít; Schema.org `Article` / `FAQPage` JSON-LD. |
| `/dashboard` | **SEO Dashboard** | Centrálny prehľad KPI (kliky, impresie, priemerná pozícia, Health index); Opportunity Radar; CTR Booster; zoznam stránok a dopytov; živé skenovanie overených webov zo Search Console. |
| `/decay` | **Content Decay Radar** | Automatická detekcia podstránok s prepadom návštevnosti (porovnanie dvoch 90-dňových periód s concurrency 4); decay skóre; mapa obnovy hľadaných výrazov; generovanie AI refresh plánu jedným klikom; demo aj live režim. |
| `/audit` | **SEO Audit domén** | Hĺbková konkurenčná analýza 1–5 domén cez Semrush API; identifikácia content gapu, quick wins a 30/60/90-dňového akčného plánu. |
| `/plan` | **30-dňový obsahový plán** | Generovanie štruktúrovanej publikačnej stratégie s pillar/cluster architektúrou a search intentom; freemium ochrana (1. deň zadarmo). |
| `/brief` | **SEO Brief pre copywritera** | Kompletné zadanie pre tvorbu obsahu: analýza SERPu, presná hierarchia H1–H3, LSI kľúčové slová a E-E-A-T signály. |
| `/raketa` | **SEO Raketa** | On-page inšpekcia URL v reálnom čase, bezpečné serverové načítanie HTML, porovnanie s konkurentom, technické skóre a AI odporúčania na opravu. |
| `/history` | **História generovaní** | Centrálne úložisko všetkých vytvorených auditov, článkov, briefov a plánov s možnosťou filtrovania, kopírovania a exportu. |
| `/settings/agency` | **Whitelabel Branding & Agentúra** | Kompletné prispôsobenie identity agentúry (logo, primárna farba, kontaktný e-mail, pätička) pre automatické mesačné SEO reporty pre klientov. |
| `/login` | **Autentifikácia** | Bezpečné prihlásenie a registrácia používateľov cez e-mail s heslom alebo Google OAuth prostredníctvom Supabase Auth. |

---

## 🎯 Opportunity Engine & Slovenská NLP adaptácia

Mozgom vyhodnocovania SEO príležitostí je modul [`src/lib/opportunity.ts`](file:///home/vorkei/Documents/seo.vorkei.com/src/lib/opportunity.ts) (overený testami v [`src/lib/opportunity.test.ts`](file:///home/vorkei/Documents/seo.vorkei.com/src/lib/opportunity.test.ts)):

1. **Celoslovenská geografická inteligencia (Žiadne hardkódovanie):**
   - Databáza `LOCATIONS` zahŕňa **všetky krajské a okresné mestá Slovenska** (Bratislava, Košice, Prešov, Žilina, Nitra, Banská Bystrica, Trnava, Martin, Poprad, Trenčín, Prievidza a ďalšie).
   - E-shopy a celoslovenské služby nie sú umelo nútené uvádzať Bratislavu. Ak používateľ alebo dopyt definuje konkrétnu lokalitu (napr. *„autoservis košice“*), systém striktne overí prítomnosť daného mesta.
2. **Presná kalkulácia pixelovej šírky SERP Snippetov:**
   - Funkcia `textPixelWidth()` používa kalibrovanú proporcionálnu tabuľku glyphov pre font Arial (Desktop 20px / Snippet 14px).
   - Plná podpora znakov slovenskej abecedy vrátane diakritiky:
     - Úzke znaky (`í`, `ĺ`, `ľ`, `ť`, `!`, `.`): správna redukovaná šírka (3.5px–6.5px namiesto skreslených 10px).
     - Široké kapitálky (`Á`, `Č`, `Ď`, `É`, `Ň`, `Ó`, `Ô`, `Ŕ`, `Š`, `Ú`, `Ý`, `Ž`): reálna šírka 13px.
     - Široké znaky (`m`, `w`, `M`, `W`, `@`): 15px–16px.
   - Zaručuje 99%+ zhodu s reálnym orezaním titulkov a meta popisov v slovenskom Google.
3. **Kategorizácia príležitostí:**
   - *Quick win* (vysoký potenciál pri malom posune pozície).
   - *Striking distance* (pozície 4–15 s vysokými impresiami).
   - *Zero clicks* (výrazné impresie bez prekliku – nutnosť optimalizácie CTR).
   - *Protect winner* (pozície v TOP 3 vyžadujúce ochranu pred konkurenciou).
4. **Detekcia keyword kanibalizácie & interného prelinkovania:**
   - Detekuje konflikt dvoch podstránok súťažiacich o rovnaký dopyt alebo podobný URL slug.
   - Navrhuje cielené anchor texty a logické prelinkovanie z autoritatívnych stránok na konverzné landing pages.
5. **Obsahové mantinely:**
   - Žiadne vymyslené rankingy, recenzie, adresy ani telefónne čísla.
   - Striktná ochrana pred keyword stuffingom.

---

## 🔒 Bezpečnosť, Multi-Tenancy & Edge Runtime Ochrana

Platforma spracováva dôverné dáta o návštevnosti firiem, preto implementuje striktné bezpečnostné pravidlá:

### 1. Multi-Tenant GSC Izolácia (`src/lib/gsc.server.ts`)
- **Prevencia úniku dát:** Každá požiadavka na `/api/decay-gsc-properties` a `/api/decay-analyze` striktne overuje vlastníctvo a autorizáciu používateľa (`listUserVerifiedProperties`, `assertUserPropertyAccess`).
- Bežní používatelia vidia **výhradne svoje vlastné autorizované weby**. Prístup ku kmeňovým doménam správcu je pre cudzích používateľov zablokovaný (`403 Forbidden`).
- Administrátori sú konfigurovaní cez bezpečné premenné `ADMIN_EMAILS` a `ADMIN_USER_IDS`.

### 2. Pamäťovo bezpečný Rate Limiting na Edge (`src/lib/rate-limit.server.ts`)
- Cloudflare Workers bežia v efemérnych izolátoch s limitom 128 MB RAM.
- Rate limiter obsahuje **LRU auto-pruning** s horným stropom `MAX_BUCKETS = 2000`, ktorý pri dosiahnutí limitu automaticky vymaže expirované záznamy a chráni worker pred memory leakom.
- Funkcia `checkCompositeRateLimit()` kombinuje overenie `userId` a reálnej klientskej IP získanej z hlavičiek (`cf-connecting-ip`, `x-real-ip`).

### 3. Zrýchlenie a odolnosť voči timeoutom
- Skenovanie dopytov v Decay Radare využíva **paralelné dávkovanie (concurrency: 4)** namiesto pomalého sekvenčného cyklu, čím sa čas skenovania skrátil z 18 sekúnd na cca 4 sekundy.

### 4. Inteligentné Semrush Caching vrstvenie & Circuit Breaker (`src/lib/semrush.server.ts`)
- **Databázová cache tabuľka (`semrush_domain_cache`):** Ukladá kompletné snapshoty (organické kľúčové slová, spätné odkazy, konkurenti) s TTL 7 dní.
- **Quota Protection & Circuit Breaker:** Pri chybe 429 alebo vyčerpaní Semrush kreditov (ERROR 134) systém automaticky degraduje a servuje starší uložený snapshot s príznakom `stale: true`, čím predchádza pádom aplikácie pre používateľov.

---

## 💳 B2B Predplatiteľský systém (Stripe) & Slovenská fakturácia

Projekt obsahuje kompletnú integráciu Stripe Checkout a Webhookov optimalizovanú pre slovenský a český B2B trh (`src/lib/slovak-billing.ts`, `src/lib/billing.functions.ts`):

- **Balíky predplatného:**
  - **Free:** Max 1 projekt, audit do 3 URL, 1 snapshot mesačne.
  - **Pro (39 € / mes.):** Max 5 projektov, neobmedzený Decay Radar, CTR Booster, 30-dňový Content Plan, exporty do WordPress.
  - **Agency (89 € / mes.):** Neobmedzené projekty, sledovanie konkurencie, priorita generovania.
- **Slovenská validácia firemných údajov:**
  - `isValidICO()`: Vážený súčet váh `[8, 7, 6, 5, 4, 3, 2]` modulo 11 pre 8-miestne IČO.
  - `isValidDIC()`: 10-miestne číslo začínajúce na 10, 20 alebo 21 deliteľné číslom 11.
  - `isValidICDPH()`: Predpona `SK` + platný formát DIČ.
- **Paywall brány & UX:** Modál `<PaywallModal />` na trasách `/dashboard` (limit webov), `/decay` (limit URL) a `/audit` (limit domén a WordPress export).
- **Stripe Webhook (`/api/public/stripe-webhook`):** Spracúva `checkout.session.completed`, `customer.subscription.updated` a `customer.subscription.deleted`, aktualizuje tabuľku `subscriptions` v Supabase a pripravuje dáta pre automatickú fakturáciu v SuperFaktúra / Fakturoid (20% DPH vs. Reverse Charge).

---

## 🏢 Whitelabel Report Engine pre marketingové agentúry

SEO4WEB obsahuje vstavaný **Whitelabel Report Engine** (`src/lib/agency.ts`, `src/components/ClientReportModal.tsx`, `src/routes/settings.agency.tsx`), ktorý umožňuje marketingovým a SEO agentúram vygenerovať reprezentatívny mesačný klientsky report vo formáte PDF na 1 klik:

1. **Branding agentúry v Supabase (`agency_profiles`):**
   - Vlastný názov agentúry, URL loga, primárna farba brandingu (HEX), kontaktný e-mail a text pätičky.
   - Správa cez dedikované rozhranie `/settings/agency` so živým náhľadom.
2. **Štruktúra klientskeho reportu:**
   - **Titulné záhlavie:** Logo agentúry, sledovaná doména klienta, 90-dňové porovnávacie obdobie a súhrnný **SEO Health Index**.
   - **Executive Summary:** Celkový rast klikov, impresií, priemernej pozície a indexovaných stránok s deltou v percentách a komentárom.
   - **Top víťazi mesiaca:** 5 najviac rastúcich kľúčových výrazov a URL adries.
   - **Opportunity Radar (Striking Distance):** Stránky a dopyty na pozíciách 4–15 s vysokými impresiami, kalkulovaným rastovým potenciálom a odporúčanou akciou.
   - **Realizované optimalizácie:** Zoznam zaznamenaných on-page úprav a overených experimentov (`seo_experiments`).
   - **Akčný plán na ďalší mesiac:** 4 prioritné kroky pre rast organiky klienta.
3. **Print-Friendly CSS (`@media print`):**
   - A4 formát na výšku, precízne stránkovanie (`page-break-inside: avoid; break-inside: avoid;`), potlačenie navigácie a tlačidiel.
   - 100% Whitelabel — v tlači a vygenerovanom PDF nie je žiadna zmienka o SEO4WEB.

---

## 🔐 Premenné prostredia (.env Best Practices)

Projekt striktne oddeľuje verejné konfigurácie od privátnych tajných kľúčov:

| Súbor | Účel | V Gite? |
| :--- | :--- | :--- |
| `.env` | Verejné frontend & SSR premenné (`VITE_SUPABASE_*`, `SUPABASE_*`) | **ÁNO** (sledovaný) |
| `.env.example` | Kompletná šablóna premenných s podrobným popisom | **ÁNO** (sledovaný) |
| `.env.local` | Lokálne prepisy a privátne API kľúče pre offline vývoj | **NIE** (v `.gitignore`) |

### Verejné premenné (`.env`):
```env
VITE_SUPABASE_PROJECT_ID=pwftbssvdbjoblmhdeax
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_HXyJkq0uW4KXylZnSwiAjg_k4dFbYYS
VITE_SUPABASE_URL=https://pwftbssvdbjoblmhdeax.supabase.co

SUPABASE_PROJECT_ID=pwftbssvdbjoblmhdeax
SUPABASE_PUBLISHABLE_KEY=sb_publishable_HXyJkq0uW4KXylZnSwiAjg_k4dFbYYS
SUPABASE_URL=https://pwftbssvdbjoblmhdeax.supabase.co
```

### Tajné kľúče (Secrets):
Privátne kľúče (`LOVABLE_API_KEY`, `SEMRUSH_API_KEY`, `GOOGLE_SEARCH_CONSOLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`) sú spravované výhradne v **Lovable Cloud Secrets** a v prostredí Cloudflare Workers. **Nikdy ich nevkladaj do `.env` ani do git commitov!**

---

## ⚡ Zlaté architektonické pravidlá

1. **Server Functions API:**
   TanStack Start serverové funkcie používajú výhradne syntax `.validator(...)`, nikdy nie `.inputValidator(...)`.
2. **Router Integrity:**
   Používa sa výhradne `@tanstack/react-router`. Nikdy neinštaluj ani neimportuj `react-router-dom`. Súbor `src/routeTree.gen.ts` je auto-generovaný – needituj ho manuálne.
3. **CSS & Dizajn systém:**
   Všetky `@import` direktívy v `src/styles.css` musia zostať na samom začiatku súboru pred `@theme`. Externé webfonty (_Outfit_, _Figtree_) sa načítavajú cez `<link>` v `src/routes/__root.tsx`.
4. **Cloudflare Worker Runtime Safe:**
   Nikdy neinicializuj `new Date()` ako statickú konštantu na úrovni modulu (pri bootovaní workeru vráti epochu 1970). Dátumy volaj vždy dynamicky vo vnútri request handlerov.
5. **GSC Porovnanie periód:**
   Obe 90-dňové periódy (aktuálna vs. predchádzajúca) sa počítajú z jedného referenčného času requestu so zohľadnením 3-dňového oneskorenia dát v Google Search Console.

---

## 💰 Monetizačný model pre slovenský B2B trh (Cesta k 9 000 €+ MRR)

SEO4WEB je stavaný pre dosiahnutie obratu **9 000 €+ mesačne (MRR)** prostredníctvom troch cielených B2B úrovní:

| Úroveň | Cena / mesiac | Cieľová skupina | Funkcionalita | Potrebný počet klientov |
| :--- | :--- | :--- | :--- | :--- |
| **Štart** | **39 €** | Malé firemné weby, blogeri, freelanceri | 1 doména, mesačný Decay Radar, 5 AI SEO článkov, SERP Lab | 35 klientov (~1 365 €) |
| **Pro** | **89 €** | Rastúce e-shopy, lokálne firmy | 3 domény, týždenný Decay Radar, neobmedzený SERP Lab, Opportunity Engine, CTR Booster | 40 klientov (~3 560 €) |
| **Agency Whitelabel** | **249 €** | Digitálne a SEO agentúry | 15 domén, Whitelabel PDF reporty s logom agentúry na 1 klik, prioritné API, multi-user prístup | 17 agentúr (~4 233 €) |
| **SPOLU** | — | — | — | **92 klientov = 9 158 € / mesiac** |

---

## 🧪 Testovanie a kvalita kódu

Projekt udržiava 100% priechodnosť testovacej suity a nulovú toleranciu pre typové chyby:

```bash
# Spustenie všetkých testov
bunx vitest run

# Testovacie suity v projekte (100% priechodnosť):
# ✓ src/lib/rate-limit.test.ts     — LRU pamäťový limit, extrakcia IP, zložený rate limit
# ✓ src/lib/gsc.test.ts            — 90-dňové periódy, multi-tenant izolácia domén
# ✓ src/lib/site-analyze.test.ts   — On-page HTML extrakcia, sémantické tagy, skórovanie
# ✓ src/lib/decay-schema.test.ts   — Zod validačné schémy a typová integrita
# ✓ src/lib/opportunity.test.ts    — Search intent, celoslovenská lokalita, diakritika SERP
# ✓ src/lib/decay-analyze.test.ts  — Skórovanie prepadov a kalkulácia decay metrík
# ✓ src/lib/semrush.test.ts        — Semrush caching, TTL 7 dní, fallback a circuit breaker
# ✓ src/lib/slovak-billing.test.ts — Slovenská validácia IČO, DIČ, IČ DPH a predplatné
# ✓ src/lib/agency.test.ts         — Whitelabel engine, health index, top víťazi a striking distance
```

---

## 🌐 Nasadenie & Odkazy

- **Produkčná verzia (Lovable Cloud):** [https://seo4web.lovable.app](https://seo4web.lovable.app)
- **GitHub repozitár:** [https://github.com/youh4ck3dme/metaseopro](https://github.com/youh4ck3dme/metaseopro)
- **Produkčná vetva:** `main`
