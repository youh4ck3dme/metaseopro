# SEO4WEB — AI SEO Command Center

SEO4WEB je moderná slovenská all-in-one SEO platforma, ktorá prepája reálne dáta z Google Search Console, Semrush a AI modely na jednom mieste: automaticky identifikuje príležitosti rastu, deteguje poklesy návštevnosti (Content Decay) a generuje optimalizovaný obsah pripravený na schválenie človekom.

---

## 🚀 Rýchly štart (Lokálny vývoj)

Projekt využíva **Bun v1.4+** (prípadne Node.js v22 LTS) s vývojovým serverom Vite bežiacim na porte **8080**:

```bash
# Inštalácia závislostí
bun install

# Spustenie lokálneho vývojového servera
bun dev
# Aplikácia je dostupná na http://localhost:8080 (alebo http://127.0.0.1:8080)

# Spustenie testov
bunx vitest run

# Typová kontrola kódu
bun run tsc --noEmit

# Produkčný build
bun run build
```

---

## 🔄 Git Workflow & Obojsmerná synchronizácia (Local ↔ GitHub ↔ Lovable)

Projekt je prepojený s GitHub repozitárom [`youh4ck3dme/metaseopro`](https://github.com/youh4ck3dme/metaseopro) na hlavnej vetve `main` a cloudovým prostredím Lovable. Pre bezproblémovú synchronizáciu bez konfliktov a rozdvojených vetiev dodržuj tento **trojkrokový workflow**:

### 1. Pred začiatkom práce vždy stiahnuť zmeny (z Lovable / GitHubu)
```bash
git pull --rebase origin main
```

### 2. Po úpravách overiť funkčnosť
```bash
bunx vitest run
```

### 3. Zcommitovať zmeny s GPG podpisom a poslať do main
```bash
git add .
git commit -m "feat/fix: stručný popis úpravy"
git push origin main
```

> [!TIP]
> Lovable zachytí push priamo do vetvy `main` a automaticky zosynchronizuje zmeny do cloudového editora a produkcie.

---

## 🛠️ Architektúra a technológie

- **Frontend & SSR:** TanStack Start v1 (React 19 + SSR + Vite 8).
- **Routing:** `@tanstack/react-router` (striktne typovaný filesystémový routing v `src/routes/`).
- **Data Fetching:** `@tanstack/react-query` v5.
- **Štýly & Dizajn:** Tailwind CSS v4 s Lightning CSS v `src/styles.css` (OKLCH sémantické tokeny), komponenty Radix UI / shadcn, písma *Outfit* a *Figtree*.
- **Runtime & Deployment:** Cloudflare Workers (cez `@cloudflare/vite-plugin` a Nitro).
- **Backend & Databáza:** Lovable Cloud (Supabase PostgreSQL `pwftbssvdbjoblmhdeax.supabase.co`) s Row Level Security (RLS) a JWT autentifikáciou.
- **ORM & Migrácie:** Drizzle ORM (`drizzle/`).

---

## 📂 Prehľad modulov

| Cesta | Modul | Funkcionalita |
| --- | --- | --- |
| `/` | **Blog Writer + SERP Lab** | Tvorba článkov z témy alebo GSC dát, reálny náhľad v Google (desktop/mobil), A/B/C varianty titulkov a meta popisov, kontrola pokrytia kľúčových slov, Schema.org JSON-LD |
| `/dashboard` | **SEO Dashboard** | KPI metriky (kliky, impresie, pozícia, Health index), Opportunity Radar, CTR Booster, výpis URL a dopytov, živé skenovanie overených webov |
| `/decay` | **Content Decay Radar** | Porovnanie posledných 90 dní s predchádzajúcim obdobím, decay skóre, query recovery mapa, AI akčný plán obnovy; plný demo aj live režim |
| `/audit` | **SEO Audit** | Komplexná analýza 1–5 domén cez Semrush, content gap, quick wins a 30/60/90-dňový akčný plán |
| `/plan` | **30-dňový plán** | Štruktúrovaný obsahový plán s pillar/cluster architektúrou a search intentom (1. deň zadarmo) |
| `/brief` | **SEO Brief** | Detailné zadanie pre copywritera: SERP analýza, nadpisy H1–H3, odporúčania pre E-E-A-T |
| `/raketa` | **SEO Raketa** | Hĺbková on-page previerka URL, serverové načítanie HTML, porovnanie s konkurentom, AI odporúčania |
| `/history` | **História** | Centrálne úložisko všetkých vygenerovaných auditov, plánov, briefov a článkov s filtrami |
| `/login` | **Prihlásenie** | Autentifikácia cez e-mail a Google OAuth prostredníctvom Supabase Auth |

---

## 🎯 Opportunity Engine

Logika vyhodnocovania SEO príležitostí v `src/lib/opportunity.ts` (testovaná v `src/lib/opportunity.test.ts`):
- Stránka sa započíta pri **≥ 20 zobrazeniach alebo ≥ 1 kliku**.
- Automatická detekcia search intentu (informačný, komerčný, transakčný, navigačný).
- Skórovanie príležitostí a kategorizácia: *Quick win*, *Striking distance*, *Zero clicks*, *Protect winner*.
- Detekcia keyword kanibalizácie a odporúčania interného prelinkovania.
- Pixelová kalkulácia dĺžky titulkov a meta popisov v Google SERP.
- **Pravidlá obsahu:** Žiadne vymyslené rankingy, recenzie ani adresy, žiadny keyword stuffing a žiadne nekontrolované publikovanie.

---

## 🔐 Premenné prostredia (.env best practices)

Systém striktne oddeľuje verejné klientske konfigurácie od serverových tajných kľúčov:

| Súbor | Účel | V Gite? |
| --- | --- | --- |
| `.env` | Verejné frontend & SSR premenné (`VITE_SUPABASE_*`, `SUPABASE_*`) | **ÁNO** (sledovaný) |
| `.env.example` | Kompletná šablóna všetkých podporovaných premenných s popisom | **ÁNO** (sledovaný) |
| `.env.local` | Lokálne prepisy a lokálne API kľúče pre offline vývoj | **NIE** (v `.gitignore`) |

### Verejné premenné v `.env`:
```env
VITE_SUPABASE_PROJECT_ID=pwftbssvdbjoblmhdeax
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_HXyJkq0uW4KXylZnSwiAjg_k4dFbYYS
VITE_SUPABASE_URL=https://pwftbssvdbjoblmhdeax.supabase.co
```

### Tajné kľúče (Secrets):
Tajné kľúče (`LOVABLE_API_KEY`, `SEMRUSH_API_KEY`, `GOOGLE_SEARCH_CONSOLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) sú spravované výhradne v **Lovable Cloud Secrets** a v Cloudflare Worker prostredí. **Nikdy ich nevkladaj do `.env` ani do git commitov!**

---

## ⚡ Zlaté architektonické pravidlá

1. **Server Functions API:**
   TanStack Start serverové funkcie používajú výhradne syntax `.validator(...)`, nikdy nie `.inputValidator(...)`.
2. **Router:**
   Používa sa výhradne `@tanstack/react-router`. Nikdy neinštaluj ani neimportuj `react-router-dom`.
3. **CSS & Dizajn systém:**
   Tailwind CSS v4 v `src/styles.css` vyžaduje všetky `@import` direktívy na samom začiatku súboru pred `@theme`. Externé webfonty (*Outfit*, *Figtree*) sa načítavajú cez `<link>` v `src/routes/__root.tsx`.
4. **Cloudflare Worker Runtime Safe:**
   Nikdy neinicializuj `new Date()` ako statickú konštantu na úrovni modulu (pri štarte workera vráti epochu 1970). Dátumy volaj dynamicky vo vnútri handlerov požiadaviek.

---

## 🌐 Nasadenie

- **Produkčná verzia (Lovable Cloud):** [https://seo4web.lovable.app](https://seo4web.lovable.app)
- **GitHub repozitár:** [https://github.com/youh4ck3dme/metaseopro](https://github.com/youh4ck3dme/metaseopro)
