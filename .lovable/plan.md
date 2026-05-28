
# Plán: Vylepšenie každej SEO funkcie v Písmo (+25–75%)

Cieľ: každý zo 4 nástrojov posunúť na vyššiu úroveň cez (a) hlbší prompt, (b) viac vstupných parametrov, (c) lepšie UX a (d) reálne SEO dáta zo Semrush konektora tam, kde to dáva zmysel.

---

## 1) Blog Writer (`/` + `/api/generate-article`)  — cieľ +50%

**Prompt upgrade (`src/lib/article-prompt.ts`)**
- Pridať povinnú sekciu: **TL;DR (3 odrážky)** hneď pod H1.
- **Key takeaways** box po úvode.
- **People Also Ask** sekcia (4–6 PAA otázok) okrem klasického FAQ.
- **Schema.org JSON-LD** (Article + FAQPage) na konci v ```json bloku.
- **Internal/external link placeholdery** s reálnym anchor textom (nie „kliknite sem“).
- E-E-A-T blok: „Prečo môžeš tomuto článku veriť" (autor/skúsenosť placeholder).
- Cieľová dĺžka 1800–2800 slov ostáva, ale s **explicitným word-count cieľom pre každú H2**.

**UI/UX (`src/routes/index.tsx`)**
- Pridať voliteľné polia (collapsible „Pokročilé"):
  - Primárne keyword (override)
  - Cieľové publikum
  - Tón (priateľský / expertný / predajný)
  - Cieľová dĺžka (1500 / 2000 / 2800 slov)
- Tieto polia sa pošlú do API a serializujú do user promptu.

**API (`src/routes/api/generate-article.ts`)**
- Zod schema namiesto ručnej validácie.
- Prijať nové voliteľné polia, validovať dĺžky.

---

## 2) SEO Audit (`/audit` + `/api/audit-domains`) — cieľ +60%

**Prompt upgrade (`src/lib/audit-prompt.ts`)**
- Pridať sekciu **„Top 10 keyword overlap"** medzi doménami.
- **Backlink quality breakdown** (toxic vs authority links na základe AS distribúcie).
- **Content gap matrix** ako markdown tabuľka (téma × doména × pokrytie).
- **Priority score (1–10)** pre každú príležitosť (volume × intent × difficulty).
- **30/60/90 dňový action plan** namiesto generického "3 quick wins".

**Semrush rozšírenie (`src/lib/semrush.server.ts`)**
- K existujúcemu snapshotu pridať: `backlinks_overview` (toxicity, AS distribúcia), `domain_organic` top 20 KW (z 10), a pre prvú doménu `competitive_analysis` na auto-objavenie ďalších konkurentov.
- Tieto dáta poslať do AI v štruktúrovanom JSON.

**UI (`src/routes/audit.tsx`)**
- Pridať selector trhu (sk / cz / us / uk / de) → pošle sa do Semrush `database`.
- Voliteľné pole „Tvoja doména" (oddelená od konkurentov) → audit sa zameria explicitne na to, ako *ty* môžeš predbehnúť ostatných.

---

## 3) Content Plan (`/plan` + `content-plan.functions.ts`) — cieľ +75%

**Prompt upgrade (`src/lib/content-plan-prompt.ts`)**
- Každý deň dostane navyše:
  - **Search intent** (info/commercial/transactional)
  - **Funnel stage** (TOFU/MOFU/BOFU)
  - **Distribučné kanály** (LinkedIn hook, newsletter angle)
  - **Odhadovaná difficulty** (nízka/stredná/vysoká)
- **Pillar + cluster mapa** ako vizuálna ASCII/markdown štruktúra na začiatku.
- **Tématická kadencia** (pondelok = how-to, utorok = listicle…) pre konzistentnosť.
- **KPI per týždeň** s konkrétnymi číslami (impressions/clicks goals).

**UI (`src/routes/plan.tsx`)**
- Nové polia: cieľové publikum, current Authority Score (self-assess slider), preferované typy obsahu (multi-select chips).
- Po vygenerovaní: **export do CSV** (deň, nadpis, KW, typ, dĺžka, CTA) okrem .md.

**Funkcia**
- Uložiť plán štruktúrovane (parse markdown → days[]) do `generated_outputs.metadata`, aby sa dal neskôr filtrovať/editovať deň po dni.

---

## 4) SEO Brief (`/brief` + `/api/generate-brief`) — cieľ +50%

**Prompt upgrade (`src/lib/brief-prompt.ts`)**
- Pridať sekcie:
  - **19. SERP analýza** — čo je v top 10, content type, priemerná dĺžka, formát.
  - **20. Content angle differentiator** — 3 konkrétne uhly ako prebiť top 3.
  - **21. Outline so slovo-počtami** pre každú H2/H3.
  - **22. Skip-list** — čo do článku NEPATRÍ a prečo.
  - **23. Image brief** — 3–5 návrhov obrázkov s alt textami.

**Semrush integrácia (nová)**
- Ak je doména pripojená cez Semrush konektor: pri generovaní briefu pre keyword zavolať `keyword_research` + `serp_analysis` a injektovať reálne dáta (volume, KD, top 10 SERP) do user promptu.
- Fallback: ak konektor chýba, brief beží ako teraz.

**UI**
- „Načítať reálne SEO dáta zo Semrush" toggle pred generovaním.
- Po wygenerovaní: tlačidlo „Generuj článok z briefu" už existuje — pridať aj „Generuj 30-dňový plán okolo tohto pilieru".

---

## Cross-cutting vylepšenia

- **Streaming UX**: pridať odhad tokenov/progress bar (na základe SSE chunkov).
- **Model upgrade**: voliteľne prepnúť audit a brief na `google/gemini-2.5-pro` pre hlbšiu analýzu (flash zostáva pre article/plan kvôli rýchlosti).
- **Rate-limit**: zjednotiť cez `rate-limit.server.ts` pre všetky 3 generujúce endpointy (article ešte nemá).
- **History (`/history`)**: pridať filter podľa typu a tag/star pre obľúbené výstupy.

---

## Technické poznámky

- Žiadne breaking changes v DB schéme nutné okrem voliteľného `metadata jsonb` na `generated_outputs` (ak ešte chýba) — preverím v migrácii a doplním ak treba.
- Všetky nové polia validovať cez Zod.
- Semrush volania ostávajú server-side cez existujúci `semrush.server.ts` (rozšírim o nové metódy: `backlinks_overview`, `phrase_kdi`, SERP).
- Mobile layout (375px) — všetky nové „Pokročilé" panely v `<Collapsible>` aby nezahltili malý viewport.

---

## Acceptance criteria

- Každý nástroj produkuje výrazne hlbší a štruktúrovanejší výstup než dnes.
- Žiadna regresia v existujúcich tokoch (auth, save do history, copy/download).
- TypeScript build clean, žiadne console errory.
- 375px / 768px / desktop layouty funkčné.
- RLS a auth nezmenené, žiadne nové verejné endpointy.

Po schválení implementujem všetky 4 vylepšenia v jednom build cykle.
