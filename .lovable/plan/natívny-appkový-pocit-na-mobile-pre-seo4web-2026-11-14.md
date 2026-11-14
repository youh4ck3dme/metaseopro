# Natívny "appkový" pocit na mobile pre SEO4WEB

Aplikovať pravidlá z nahraného Master Promptu, upravené pre našu appku (TanStack Start, nie Next.js) a pre SEO nástroj, kde ľudia kopírujú výsledky.

## Čo sa zmení
1. **Pevná obrazovka** – zákaz pinch/double-tap zoomu, `viewport-fit=cover`, bez gumového odskakovania a pull-to-refresh, podpora výrezov iPhonu (safe-area).
2. **Bez náhodného označovania** – dlhé podržanie na tlačidlách, kartách, menu už neoznačí text ani neotvorí systémové menu; zmizne modrý preblik pri ťuknutí.
3. **Výnimky (dôležité pre SEO appku)** – označovanie a kopírovanie zostáva povolené v:
   - poliach formulárov (input, textarea, select, editovateľný text),
   - vygenerovaných výsledkoch: články Blog Writera, title/meta varianty CTR Boostera, SERP náhľady, URL a kľúčové slová v tabuľkách, kód/HTML/Markdown exporty.
4. **Tlmené skrolovanie** – skrolovacie oblasti (menu drawer, modály, tabuľky) nepretečú na celú stránku; skryté desktopové scrollbary len na mobile/dotyku.
5. Desktop sa správa ako doteraz (pravidlá anti-select a skryté scrollbary platia iba na dotykových zariadeniach).

## Technické detaily
- `src/routes/__root.tsx`: viewport meta `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`; `theme-color` z tmavého tokenu.
- `src/styles.css` (za existujúce @import, bez narušenia poradia): blok pod `@media (hover: none) and (pointer: coarse)` s `user-select: none`, `-webkit-touch-callout: none`, `-webkit-tap-highlight-color: transparent`; výnimky `input, textarea, select, [contenteditable], pre, code, .prose, .selectable` s `user-select: text !important`.
- `html, body { overscroll-behavior: none }`; utility `.native-scroll` (overscroll contain, touch pan-y, skrytý scrollbar) a `.safe-top/.safe-bottom`, ak už neexistujú z responzívneho kroku.
- Pridať triedu `selectable` na výstupné bloky (Blog Writer výstup, CtrBooster varianty, Explorer URL/query bunky, SERP Lab) a `native-scroll` na drawer/modály.
- Overenie: Playwright na 390px mobile (dlhé podržanie, písanie a vkladanie do polí, kopírovanie výsledku), desktop 1280px bez zmeny; vitest.

Poznámka: zákaz zoomu zhoršuje prístupnosť pre slabozrakých – ak chceš, môžeme zoom ponechať a zamknúť len double-tap.
