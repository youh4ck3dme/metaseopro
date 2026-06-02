## SEO Raketa — automatizovaný SEO workflow

Pridáme jeden nový samostatný workflow na `/raketa`. Nič z existujúceho (Blog Writer, SEO Audit, Content Plan, SEO Brief, História, navigácia, dizajn) sa nemení ani nerozbije. Zachováme minimalistický čierno-biely editorial štýl a plnú responzivitu.

### Čo používateľ zadá
- Vlastná URL webu
- URL konkurencie (voliteľné)
- Cieľový keyword / téma
- Jazyk: Slovenčina / Čeština / English
- Cieľ výstupu: SEO audit, konkurenčný report, SEO blog článok, content brief, 30-dňový content plán, landing page copy

### Priebeh (stavy: Validating → Scanning → Comparing → Generating → Ready)

**Krok 1 — Validácia URL**
- Akceptuje len platné `http/https` URL, blokuje prázdny/poškodený vstup, priateľské chybové hlášky (client + server validácia cez zdieľanú Zod schému).

**Krok 2 — Analýza webu a konkurencie**
- Server stiahne HTML vlastnej (a ak je zadaná, konkurenčnej) stránky a vyextrahuje: `<title>`, meta description, H1/H2/H3, súhrn viditeľného textu, CTA náznaky, štruktúru obsahu.
- Porovná web vs konkurencia, deteguje content gapy, chýbajúce keywordy, slabé nadpisy, slabú meta description, nejasné CTA.
- Fallback: ak fetch zlyhá alebo vráti tenký HTML (JS-heavy web), vráti štruktúrovaný mock s jasným príznakom „odhad", aby workflow nikdy nespadol. Kód je oddelený tak, že sa neskôr dá vymeniť za robustnejší crawler.

**Krok 3 — AI SEO stratégia**
- AI (Lovable AI gateway, streamované) vygeneruje: SEO skóre, priority fixes, keyword príležitosti, výhody konkurencie, odporúčané témy článkov, odporúčanú štruktúru stránky, meta title + meta description, H1/H2/H3 outline, FAQ, návrhy interného prelinkovania, 30-dňový content plán.

**Krok 4 — Generátor výstupu**
- Podľa zvoleného cieľa sa naformátuje finálny výstup (audit / konkurenčný report / blog článok / brief / 30-dňový kalendár / landing page copy).

**Krok 5 — História**
- Každý projekt sa uloží do existujúcej tabuľky `generated_outputs` (URL, konkurencia, keyword, dátum, typ výstupu, výsledok) a zobrazí v existujúcej Histórii.

### UI
- Veľká hero input karta na `/raketa`:
  - Titulok: „Zadaj web. My odpálime SEO raketu."
  - Podtitulok: „Analyzuj vlastný web, konkurenciu alebo oboje. Výstup: audit, článok, brief alebo content plán."
- Progress indikátor s piatimi stavmi, loading skeletony počas behu.
- Výsledné karty po sekciách, každá s funkčným „Kopírovať" tlačidlom.
- „Export ako Markdown" tlačidlo pre celý výstup.
- Chybové stavy pre zlyhanie fetchu URL aj zlyhanie AI.
- Plne responzívne (mobil/tablet/desktop). Žiadne nefunkčné tlačidlá.

### Technická realizácia (oddelená UI logika od workflow logiky)

Nové súbory:
- `src/lib/raketa-schema.ts` — zdieľané Zod schémy + validácia/normalizácia URL (client-safe).
- `src/lib/site-analyze.server.ts` — server-only: fetch URL, parse HTML (title/meta/headings/text/CTA), porovnanie + detekcia gapov, mock fallback.
- `src/lib/raketa-prompt.ts` — system prompty pre stratégiu a jednotlivé typy výstupu.
- `src/routes/api/raketa-analyze.ts` — server route (auth + rate-limit + Zod), vráti štruktúrovanú analýzu (JSON DTO).
- `src/routes/api/raketa-generate.ts` — server route, SSE stream finálneho výstupu (reuse existujúceho `streamSSE`).
- `src/routes/raketa.tsx` — workflow stránka (hero, formulár, progress, skeletony, result karty, copy/export, error stavy). Workflow orchestráciu (analyze → generate) izolujeme do malých reusable funkcií/hooku, oddelene od prezentácie.

Úpravy existujúceho:
- `src/components/AppHeader.tsx` — pridať „SEO Raketa" do navigácie (desktop + mobil).
- `src/lib/outputs.functions.ts` — rozšíriť `type` enum v Zod schéme o `"raketa"` (stĺpec je text, netreba DB migráciu).
- `src/routes/history.tsx` — pridať mapovanie štítku pre nový typ `raketa` (aby sa korektne zobrazil).

Bezpečnosť a kvalita:
- Server-side validácia všetkých vstupov (Zod), limit veľkosti tela, rate-limit a kontrola prihlásenia ako pri existujúcich endpointoch.
- URL fetch s timeoutom a limitom veľkosti odpovede, len `http/https`.
- Žiadne zmeny v `client.ts`/`types.ts`, žiadny nový verejný endpoint bez auth.
- Bez TS chýb, bez regresií existujúcich funkcií.

### Akceptačné kritériá
- Existujúce nástroje a navigácia fungujú nezmenené.
- `/raketa` prebehne celým cyklom Validating → Scanning → Comparing → Generating → Ready.
- Každé tlačidlo funguje (copy pre každú sekciu, export Markdown).
- Výstup sa uloží do Histórie a dá sa tam otvoriť.
- Funkčné na 375px, 768px aj desktope.
