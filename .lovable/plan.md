
## SEO Auditor — pridanie ako druhá funkcia do Písmo

Pridám novú stránku `/audit` (SEO Auditor) k existujúcemu blog writeru. Reálne SEO dáta budem ťahať cez **Semrush konektor** (Lovable connector gateway), a Lovable AI z nich vygeneruje brutálne úprimnú strategickú analýzu podľa tvojho expert promptu.

### UX flow
1. V hlavičke pribudne navigácia: **Blog Writer** | **SEO Audit**
2. Na `/audit`:
   - Input: 1 až 5 domén (jedno textové pole, oddelené čiarkou alebo enterom, validácia + normalizácia)
   - Tlačidlo **Spustiť analýzu**
   - Sidebar "Ako Audit pracuje" (3 kroky)
   - Hlavné plátno: streamovaný markdown report
   - Bottom action bar: Regenerovať / Kopírovať / Stiahnuť .md (rovnaký vzhľad ako pri blog writeri)
3. Empty state pred prvým spustením; loading state s indikátorom "Zbieram dáta zo Semrush..." a potom "Generujem analýzu..."

### Backend (TanStack Start server route `src/routes/api/audit-domains.ts`)
1. Validuje vstup (Zod: 1-5 domén, regex pre doménový formát, max 253 znakov každá)
2. Pre každú doménu paralelne (Promise.allSettled) volá Semrush cez gateway `https://connector-gateway.lovable.dev/semrush/...`:
   - `/domains/domain_ranks` — celkové metriky (traffic, počet kľúčových slov, authority)
   - `/domains/domain_organic` (display_limit=15) — top organické kľúčové slová
   - `/backlinks/backlinks_overview` — backlink profil (počet, ref. domény, score)
   - `/url/url_organic` voliteľne; hlavne `/domains/domain_organic_organic` na konkurentov
   - DB voľba: na základe TLD (`.sk` → `sk`, `.cz` → `cz`, inak `us` default; bude jednoduchý mapper)
3. Zlúči výsledky do kompaktnej JSON štruktúry (názvy domén, ich metriky, top KW, top konkurenti, backlinks)
4. Pošle do Lovable AI Gateway (`google/gemini-3-flash-preview`, stream) s:
   - **system prompt** = tvoj expert SEO Auditor prompt (presne v slovenčine, s 5-bodovým výstupom)
   - **user prompt** = "Tu sú reálne dáta zo Semrush pre nasledujúce domény: ..." + JSON dump
5. Streamuje SSE odpoveď klientovi (rovnaký formát ako `/api/generate-article`)
6. Error handling: 429/402 z AI gateway, 403/quota chyba zo Semrush (`ERROR 134 :: TOTAL LIMIT EXCEEDED`), chýbajúce env premenné — všetko cez toast v UI

### Connector wiring
- Pred prvým buildom pripojím **Semrush** konektor cez `standard_connectors--connect` (užívateľ vyberie / vytvorí pripojenie v built-in pickery). Po pripojení bude `SEMRUSH_API_KEY` dostupný v server runtime.
- Ak `SEMRUSH_API_KEY` chýba pri behu, endpoint vráti 503 s jasnou hláškou a UI ukáže CTA "Pripoj Semrush konektor".

### Frontend
- Nový route file `src/routes/audit.tsx` — komponent podobný `index.tsx` ale s vlastnou logikou (input domén, validácia, volanie `/api/audit-domains`)
- Spoločný layout/header: vytiahnem header + sidebar wrapper do `src/components/AppHeader.tsx` a `src/components/SidebarTips.tsx` (parametrizované — title + 3 kroky)
- Aktívny tab podľa `useRouterState`
- Markdown rendering reused (react-markdown + remark-gfm + prose triedy)
- Streaming helper rozšírim na generický `streamSSE(url, body, ...)` v `src/lib/stream-sse.ts` (nahradí súčasný `stream-article.ts`); blog writer a audit oba ho použijú
- System prompt pre auditora: `src/lib/audit-prompt.ts`
- Semrush helper: `src/lib/semrush.server.ts` (čisto serverový, .server.ts suffix blokuje klient import) s funkciami `getDomainSnapshot(domain)`, `getTopKeywords(domain)`, `getBacklinksOverview(domain)`, každý vracia normalizovaný objekt

### SEO meta
- `/audit` head: title "SEO Audit — Písmo", description o nástroji
- Aktualizujem `llms.txt` aby zahŕňal obe verejné stránky

### Súbory ktoré vzniknú / sa zmenia
- ➕ `src/routes/audit.tsx`
- ➕ `src/routes/api/audit-domains.ts`
- ➕ `src/lib/audit-prompt.ts`
- ➕ `src/lib/semrush.server.ts`
- ➕ `src/lib/stream-sse.ts` (nahradí `stream-article.ts`)
- ➕ `src/components/AppHeader.tsx`, `src/components/SidebarTips.tsx`
- ✏️ `src/routes/index.tsx` — použije nové helpery + AppHeader
- ✏️ `public/llms.txt` (ak existuje, inak vytvorím)
- 🗑️ `src/lib/stream-article.ts` (po refaktore)

### Out of scope (možno neskôr)
- Ukladanie auditov do DB / história
- Export do PDF
- Vlastný Semrush prompt na hĺbku porovnania nad rámec dát z gateway (zostávame v rozsahu povolených endpointov)
- Per-user OAuth — pripojenie Semrushu je workspace-level

### Otvorené pripomienky pred buildom
- Pred implementáciou potrebujem aby si potvrdil pripojenie **Semrush konektora** (otvorí sa picker). Bez neho endpoint nebude vedieť ťahať reálne dáta a celá hodnota nástroja padá. Ak Semrush nemáš a nechceš pripájať, viem postaviť verziu len s Firecrawl scrape + AI (slabšie čísla, ale funkčné) — daj vedieť.
