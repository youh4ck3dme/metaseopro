# Mega Master Prompt — seo.vorkei full i18n + German SEO

**Kontext:** Projekt `youh4ck3dme/metaseopro` (seo.vorkei.com). Aktuálne SK / EN / DE v `src/lib/i18n.ts`. Domain: `https://seo.vorkei.com`.

## Cieľ
Dokončiť plnohodnotné jazykové mutácie (SK, EN, DE) a technické SEO zamerané na **Nemecko a Švajčiarsko**.

## Požiadavky

### 1. Jazyky a routing
- LOCALES = `["sk", "en", "de"]`
- URL prefixy: `/sk/...`, `/en/...`, `/de/...`
- Koreň `/` redirectuje podľa cookie `locale`, inak `Accept-Language` / navigator, inak `/sk`
- Cookie `locale=sk|en|de` (1 rok, SameSite=Lax)
- Prepínač v `AppHeader` (SK | EN | DE) — zachová cestu cez `swapLocale`
- `html lang` dynamicky podľa locale
- `outputLanguage()` pre AI generovanie: SK = Slovenčina, EN = English, DE = Deutsch (DE/CH)

### 2. Preklady
- Každý user-visible string musí mať kľúč v `src/lib/i18n.ts` (sk, en, de)
- Žiadny hardcode SK/EN/DE v komponentoch (okrem fallback)
- Brand: **seo.vorkei** (nie Písmo, nie SEO4WEB, nie pismo.sk)
- og:image: `https://seo.vorkei.com/og-seo-vorkei.png`

### 3. Technické SEO
Na každej stránke:
- `<link rel="canonical" href="https://seo.vorkei.com/{locale}{path}">`
- hreflang pre `sk`, `en`, `de` a `x-default` (x-default → `/sk`)
- og:title, og:description, og:url, og:image, twitter:card
- Meta description v príslušnom jazyku
- Pre DE: targeting Nemecko + Švajčiarsko (hreflang `de` alebo `de-DE` / `de-CH` podľa potreby)

### 4. Nemecko / Švajčiarsko targeting
- DE UI strings (už v `de` dictionary)
- Príklady a placeholders s DE/CH kontextom (Zürich, München, .de / .ch domény)
- AI výstupy v nemčine keď locale=de
- Keywords a meta zamerané na „KI SEO“, „SEO Audit“, „Content Brief“, „30-Tage-Plan“ pre DACH

### 5. Čo nesmieš
- Nemazať ani necommitiť `.env` / API kľúče
- Neupravovať `routeTree.gen.ts` ručne (regeneruje Vite)
- Nezavádzať `pismo.sk` alebo „Písmo“ do UI/meta

### 6. Výstup
- Funkčný language switcher
- Canonical + hreflang na všetkých hlavných stránkach
- PR s popisom zmien
- Overenie: `/sk`, `/en`, `/de` majú správne meta a prepínač funguje

**Aktuálny stav (táto vetva):** DE dictionary pridaný, switcher v AppHeader, root hreflang sk/en/de, og:image aktualizovaný. Ďalší krok = plný `$locale` routing alebo cookie-based UI preklad na existujúcich routách.
