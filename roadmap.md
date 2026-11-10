# SEO4WEB — Technická a produktová roadmapa

## 1. Technická integrita & Bezpečnosť (Hotovo ✅)
- [x] Odstránený hardkódovaný reťazec Bratislava z Opportunity Engine; dynamická podpora 79 okresných a krajských miest SR.
- [x] Multi-tenant ochrana a striktná izolácia Google Search Console properties (`listUserVerifiedProperties`, `assertUserPropertyAccess`).
- [x] Presná pixelová kalkulácia Google SERP náhľadov pre slovenskú diakritiku (`textPixelWidth`).
- [x] Pamäťovo bezpečný Rate Limiter s LRU auto-pruningom a extrakciou klientskej IP na Cloudflare Workers.
- [x] Paralelizované dopytovanie v Content Decay Radare (`concurrency: 4`) pre elimináciu timeoutov.
- [x] 100% priechodnosť testovacej suity (6 testovacích súborov, 32 unit testov) a nulové TypeScript chyby.

## 2. Výkon & Zníženie API nákladov (Fáza 2 🔄)
- [ ] 7-dňová perzistentná cache pre Semrush audity v Supabase (`semrush_domain_cache`).
- [ ] Predchádzanie prekročeniu kvóty Semrush API (`ERROR 134`).
- [ ] Snapshotovanie výsledkov auditu pre okamžité znovunačítanie.

## 3. Monetizácia & Slovenský B2B Onboarding (Fáza 3 🔄)
- [ ] 3-stupňová cenotvorba (Štart 39 €, Pro 89 €, Agency Whitelabel 249 €).
- [ ] Stripe Checkout s políčkami pre IČO, DIČ a IČ DPH (VIES validácia).
- [ ] Automatizované vystavovanie riadnych slovenských daňových dokladov (SuperFaktúra webhook).
- [ ] Paywall na hĺbkové audity a generovanie nad limit bezplatných výstupov.

## 4. Whitelabel Agency Engine (Fáza 4 🔄)
- [ ] Serverový generátor klientskych PDF reportov (`/api/reports/whitelabel-pdf`).
- [ ] Nahratie vlastného loga agentúry, firemných farieb a kontaktu na account manažéra.
- [ ] Zdieľateľný odkaz na interaktívny bezbrandový webový report pre klienta.
