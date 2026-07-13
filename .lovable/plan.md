# Stav projektu Písmo / Piiismo

## ✅ Čo funguje (overené)
- TypeScript typecheck prechádza bez chýb (`tsgo --noEmit` = 0 chýb).
- Existujúce nástroje a routy sú v poriadku: `/` (Blog Writer), `/audit`, `/plan`, `/brief`, `/raketa`, `/history`, `/login`.
- Navigácia (desktop + mobil) v `AppHeader.tsx` funguje, login redirect opravený.
- História: filter a mapovanie typov `article | audit | plan | brief | raketa` (label + ikony).
- `outputs.functions.ts` enum obsahuje `raketa`.
- Supabase auth, `generated_outputs` s RLS, server routy chránené JWT (`api-auth.server.ts`).
- Oprava CSS 500 chyby (Google Fonts presunuté do `<link>` v `__root.tsx`, `@import` poradie v `styles.css`).
- Semrush konektor je pripojený k projektu.

## ❌ Čo NEFUNGUJE / chýba (hlavný problém)
Celá funkcia **Content Decay / Decay Radar** bola predtým vytvorená, ale v aktuálnom kóde **úplne chýba** (pravdepodobne rollback). Konkrétne neexistujú:
- `src/lib/decay-schema.ts`, `decay-demo.ts`, `decay-prompt.ts`, `decay-analyze.server.ts`, `gsc.server.ts`
- `src/routes/api/decay.analyze.ts`, `decay.generate-refresh-plan.ts`, `decay.gsc-properties.ts`
- `src/routes/decay.tsx`
- nav link „Decay Radar" v `AppHeader.tsx`
- typ `decay` v `history.tsx` a v enume `outputs.functions.ts`
- Google Search Console konektor nie je vôbec pripojený k workspace.

## ⚠️ Čo treba vylepšiť / dokončiť
1. GSC pripojenie (MVP fáza podľa tvojho rozhodnutia: Lovable connector + admin/allowlist).
2. Demo režim ako fallback (nie hard-block), so 4 scenármi.
3. Zabezpečenie nových endpointov (auth + rate-limit + Zod), oddelenie demo vs. live dát.

---

# Plán: doplniť Content Decay (Demo-first) + MVP GSC

## Fáza A — Demo-first Decay Radar (bez závislosti na GSC)
Nová funkcia funguje kompletne aj bez GSC, na demo dátach. Banner: „You're viewing a demo dataset – connect Google Search Console for real analysis."

Nové súbory:
- `src/lib/decay-schema.ts` — zdieľané Zod schémy (client-safe): vstup analýzy, DTO decay tabuľky, query recovery map, refresh plan.
- `src/lib/decay-demo.ts` — 4 realistické demo scenáre: **Blog, Ecommerce, Local Business, SaaS** (decay tabuľka, URL detaily, query mapy). Každý výstup jasne označený ako demo.
- `src/lib/decay-prompt.ts` — system prompty pre AI refresh plan; každý AI výstup explicitne uvádza, že analýza je z demo dát.
- `src/lib/decay-analyze.server.ts` — server-only logika: detekcia decayu, výpočty; v demo režime číta z `decay-demo.ts`.
- `src/routes/api/decay.analyze.ts` — server route (auth + rate-limit + Zod), vráti decay dataset (demo alebo live).
- `src/routes/api/decay.generate-refresh-plan.ts` — SSE stream AI refresh plánu (reuse `stream-sse.ts`).
- `src/routes/decay.tsx` — stránka celého workflowu:
  - Decay tabuľka
  - URL detail panel
  - Query recovery map
  - AI refresh plan
  - Markdown export
  - Uloženie do histórie ako typ `decay`
  - Prepínač Demo / Live + demo banner

Úpravy existujúceho:
- `AppHeader.tsx` — pridať nav položku „Decay Radar" (desktop + mobil).
- `outputs.functions.ts` — rozšíriť enum o `"decay"`.
- `history.tsx` — pridať `decay` do `FilterType`, `Item.type`, `TYPE_LABEL`, `TYPE_ICON` (label „Decay Radar").

Pravidlá: nikdy nemiešať demo a live dáta; demo dataset je vždy jasne označený vo výstupe aj v AI texte.

## Fáza B — MVP GSC konektor (Lovable connector + allowlist)
- Pripojiť Google Search Console cez Lovable connector (`standard_connectors--connect`) — vyžaduje tvoje schválenie.
- `src/lib/gsc.server.ts` — volania GSC gateway (list verified properties, searchAnalytics/query) cez `connector-gateway.lovable.dev`, s hlavičkami `Authorization: Bearer $LOVABLE_API_KEY` + `X-Connection-Api-Key`.
- `src/routes/api/decay.gsc-properties.ts` — vráti overené properties (len z `/sites`, nikdy z user vstupu).
- Property allowlist / admin-only gating pre MVP (žiadna Pandorina skrinka per-user OAuth).
- Ak GSC nie je pripojené alebo property nedostupné → automatický fallback na Demo režim (nie chyba).

## Bezpečnosť
- Všetky nové routy: kontrola prihlásenia (JWT), Zod validácia vstupu, limit veľkosti tela, rate-limit ako pri existujúcich endpointoch.
- `siteUrl` len z GSC `/sites` odpovede, nikdy skonštruovaný z domény appky.
- Service role key sa nikde nepoužíva; žiadny nový verejný endpoint bez auth.
- Demo a live dáta striktne oddelené.

## Overenie
- `tsgo --noEmit` bez chýb.
- Manuálne prejsť `/decay` v demo režime cez všetky 4 scenáre (tabuľka → detail → query map → AI plan → export → uloženie do histórie).
- Skontrolovať, že všetky existujúce routy stále fungujú nezmenené.

## Neskoršie fázy (mimo tohto rozsahu)
- Fáza 2: per-user Google OAuth + šifrované tokeny.
- Fáza 3: plánované skeny + email alerty + platené plány.

---
**Poznámka:** Fáza B vyžaduje tvoje schválenie pripojenia Google Search Console konektora. Môžem začať Fázou A (Demo-first) hneď — funguje aj bez GSC.
