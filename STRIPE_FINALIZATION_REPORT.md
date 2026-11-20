# SEO4WEB — Stripe finalization report

Dátum kontroly: **16. 11. 2026**, časové údaje nižšie sú v Europe/Bratislava, ak nie je uvedené UTC. Report oddeľuje kontrolu kódu od vykonania migrácie, nasadenia a platby. Neobsahuje secrets ani zákaznícke exporty.

## Verdikt

| Oblasť | Stav | Dôkaz a hranica výsledku |
| --- | --- | --- |
| **A. Kód pripravený** | **PASS** | Uzamknutá inštalácia, 451/451 testov, TypeScript, build, zmenené zdrojové súbory bez lint chýb. Existujúca schválená lint výnimka je uvedená nižšie. |
| **B. Databáza pripravená** | **BLOCKED** | Opravené SQL a lokálne PGlite kontroly prešli. História, aplikovanie migrácie, grants/RLS/RPC a dáta správneho živého projektu neboli prístupné. |
| **C. Testovacie platby overené** | **BLOCKED** | Nebol dostupný prihlásený testovací účet ani izolované nakonfigurované Stripe/DB prostredie. Fixtures nie sú platba. |
| **D. Produkčná konfigurácia overená** | **FAIL** | Nasadený webhook vrátil `503 {"error":"BILLING_WEBHOOK_NOT_CONFIGURED"}`. Ostatné live nastavenia, portál a publikovaný commit zostávajú BLOCKED. |
| **E. Reálna platba overená** | **BLOCKED** | Nebola vykonaná ani osobitne schválená suma, účet a platobný prostriedok. |

**Kód možno integrovať po CI; prijímanie produkčných platieb tým nie je schválené ani overené.**

## Repozitár, commit a PR

- Repozitár: [youh4ck3dme/metaseopro](https://github.com/youh4ck3dme/metaseopro), cieľ `main`.
- Základ tejto opravy: `4bd53b62e31215998ceec986c8b0df24e0fdc21b`.
- Testovaná implementácia: [`bdd6cb09d4ea41be288adeff553e93149f8a45a2`](https://github.com/youh4ck3dme/metaseopro/commit/bdd6cb09d4ea41be288adeff553e93149f8a45a2), tree `4f6d5574f48299bf2ea1723c538416ff81308b9f`. GitHub tree sa zhodoval s lokálne overeným staged tree.
- Integračný PR: [#15 — prepare Lovable migration and verified resubscription](https://github.com/youh4ck3dme/metaseopro/pull/15). Tento report je následný dokumentačný commit v tom istom PR; nemení testovanú implementáciu.
- [CI implementácie](https://github.com/youh4ck3dme/metaseopro/actions/runs/43803934145): **PASS**, `completed/success` overené cez GitHub. Pri merge treba kontrolovať aj CI posledného PR head s týmto reportom, nie iba tento starší beh. Výsledný merge SHA, čas zlúčenia a finálne kontroly sú v zázname PR.
- Predchádzajúca oprava SuperFaktúry [PR #14](https://github.com/youh4ck3dme/metaseopro/pull/14) bola pri tejto práci potvrdená ako zlúčená; commit `59334def1cb8c3c3aca99e530d938d421cd96d0e`.
- Overenie podpisu cez GitHub Git Commit API: predchádzajúci commit `59334def…` má `verified=true`, `reason=valid`, PGP podpis. Pracovný API commit `bdd6cb09…` má `verified=false`, `reason=unsigned`; **nie je lokálne GPG podpísaný**. Podpis výsledného squash merge treba overiť osobitne. Tento report nepredstiera podpis pracovného commitu ani ešte neovereného merge.

## Skutočne zmenené súbory

| Súbor | Zmena |
| --- | --- |
| `.env` | Odstránené iba tri duplicitné `SUPABASE_*` aliasy pridané v `4bd53b6`. Tri pôvodné verejné `VITE_SUPABASE_*` hodnoty zostali presne zachované. |
| `src/lib/billing-checkout.server.ts` | Nový nákup po skončení historického predplatného s opätovným overením Stripe session a subscription. |
| `src/lib/billing-checkout.test.ts` | Regresie pre návratový nákup, vlastníctvo, režim, unsettled payment, opakovanú operáciu a výpadok overenia. |
| `src/lib/billing-migration.test.ts` | Silnejšie katalógové, oprávňovacie, FK, lease a checkout lifecycle kontroly. |
| `supabase/migrations/20261116031733_stripe_billing_reconciliation.sql` | Päť nových tabuliek bez FK do `auth.users`; explicitné oprávnenia hneď po CREATE TABLE. |
| `docs/STRIPE_DB_CHECKS.sql` | Nový read-only preflight/postmigration skript s agregovanými výsledkami. |
| `docs/stripe.env.example` | Odstránené prázdne assignmenty rezervovaných `SUPABASE_*`; pokyn zachovať runtime bindings. |
| `docs/STRIPE_PRODUCTION_RUNBOOK.md` | Aktualizované nasadenie, reálne prístupy, test/live izolácia, obnova a odovzdanie. |
| `STRIPE_FINALIZATION_REPORT.md` | Tento report a konkrétne zostávajúce kroky. |

Žiadna zmena cenníka, dependencies, lockfile, generovaných integračných typov ani UI redesign. Pôvodný ZIP/patch sa neaplikoval znova. Produkčné secrets sa nemenili.

## Potvrdené chyby a výsledné správanie

### Migrácia pre Lovable Cloud

Odstránených je presne päť nových FK na `auth.users`. Všetky `user_id` zostávajú UUID/NOT NULL a pôvodné PK sa nemenia. Štyri väzby medzi billing tabuľkami zostávajú, vrátane cascade request → operation. Historická väzba zo staršej migrácie `subscriptions` sa nemenila.

Po každom CREATE TABLE je explicitné REVOKE pre `PUBLIC`, `anon`, `authenticated` a GRANT pre `service_role`, pred zapnutím RLS. Pri `billing_invoice_references` má `authenticated` navyše iba SELECT, obmedzený politikou na `auth.uid() = user_id`. Všetkých sedem mutačných RPC ostáva service-role-only, SECURITY INVOKER s fixným search_path.

Telá RPC, token/generácia lease, 180-sekundová lehota, 23-hodinový reconciliation stop a transakčné dokončenie udalosti sa nemenili. V testoch sa použili aj úmyselne široké predvolené ACL vrátane PUBLIC; migrácia nesmie závisieť od priaznivých platformových defaults.

Bez auth FK vymazanie účtu automaticky nemaže nové billing ledgery. Retencia, uzavretie účtu a účtovné povinnosti potrebujú samostatný schválený postup; tento release dáta nemaže.

### Opätovný nákup po zrušení

SQL správne uchováva poslednú Checkout Session. Pôvodný server však každú historickú `complete` session odmietal ako `PAYMENT_PENDING`, aj keď predplatné už skončilo. Regresia pred opravou toto zlyhanie reprodukovala.

Nový checkout pokračuje iba pri novej, ešte nedokončenej operácii a starom odlišnom platnom operation UUID. Session musí mať `payment_status` `paid` alebo `no_payment_required`. Server nanovo načíta historické predplatné a preverí jeho ID, customer, režim a prípadné owner metadata; povoľuje iba `canceled`/`incomplete_expired`.

Neukončené predplatné, rovnaká operácia, `unpaid`, neúplná legacy história a nedostupné overenie naďalej zastavia predaj. OPEN session reuse/expiry, dvojité načítanie subscription histórie, SQL lease a idempotency key zostávajú. Legacy complete bez operation UUID a nevybavené asynchrónne platby vyžadujú cielenú reconciliation.

### Verejný `.env`

Prvý celý beh skončil **450 PASS / 1 FAIL**: nezmenený integrity test odmietol tri nové serverové aliasy v tracked verejnom `.env`. V HEAD aj pracovnom strome bolo šesť názvov; Vite súbor neprepísal. Všetky tri aliasy mali rovnaké hodnoty ako ich existujúce `VITE_*` dvojčatá.

Odstránené sú len tieto tri aliasy. Frontendové hodnoty, správny backend ref a publishable key sa nemenili. **Nebolo preukázané poškodenie browser konfigurácie** — pôvodné VITE hodnoty nikdy nechýbali. Serverové runtime bindings sa overujú v Lovable; public key nenahrádza service-role prístup.

## Vykonané kontroly kódu

Lokálne prostredie: Bun **1.4.4**, Node **24.22.1**, uzamknutý Stripe SDK **23.1.0**, jeho default API verzia **2026-10-28.endive**. To nepreukazuje verziu nakonfigurovanú na dashboard webhook endpointe.

| Kontrola | Výsledok |
| --- | --- |
| `bun install --frozen-lockfile` | PASS, exit 0; bez zmeny lockfile. |
| `bunx vitest run` | PASS, **451/451**, 31 testových súborov, 0 zlyhaní. |
| `bunx tsc --noEmit` | PASS, exit 0. |
| ESLint troch zmenených zdrojových TS súborov | PASS, 0 chýb / 0 varovaní. |
| `bun run lint` | **FAIL s už schválenou výnimkou**: 349 existujúcich chýb / 9 varovaní. Všetky diagnostiky sa zhodovali s predchádzajúcim overeným release, nielen počet. |
| `bun run build` | PASS, exit 0. |
| `git diff --check` a staged diff | PASS. |
| Checkout suite | 64 testov PASS; Stripe fixtures, žiadna externá platba. |
| PGlite migration suite | 18 testov PASS; constraints, grants, RLS, RPC, vlastníctvo, lease, rollback a retry. |
| Read-only SQL inspection skript | PASS pred aj po migrácii v samostatnom lokálnom PGlite; 18 výsledkov vrátane transakčných príkazov, `transaction_read_only=on`, žiadne mutačné RPC volanie. |

Rozdelenie existujúcich lint chýb: `types.ts` 314, `previewAuthStorage.ts` 31, `IosInstallPrompt.tsx` 3, `__root.tsx` 1. Tieto súbory sa nemenili. Výnimku na 349 existujúcich chýb vlastník udelil už pred touto úlohou; nepridala sa nová výnimka a pravidlá sa nevypínali.

Vitest vypísal pri existujúcom HTTP teste `Dev server not reachable, skipping live HTTP test.` Tento test sa vracia bez živého overenia, hoci Vitest započítava jeho výsledok do úspešného behu. **451 PASS preto nie je dôkazom browser/Stripe E2E.** PGlite používa lokálne sekvenčné operácie; nie je dôkazom súbehu viacerých spojení v produkcii.

## Forenzná kontrola existujúcej implementácie

| Invariant | Lokálny výsledok | Nasadený tok |
| --- | --- | --- |
| Checkout bez konfigurácie bezpečne zlyhá | PASS v kóde/testoch; nevyrába demo úspech. | BLOCKED, prihlásený checkout nebol spustený. |
| Server určuje user/customer mapping a cenu | PASS v kóde/testoch; klient nevolí cudzie ID ani sumu. | BLOCKED, produkčné mapovania neprístupné. |
| Návraty zostávajú na povolenom SITE_URL | PASS v validatoroch a negatívnych testoch. | BLOCKED, reálny portal/checkout nebol vytvorený. |
| Webhook overuje podpis nad pôvodným telom | PASS v HTTP testoch implementácie. | BLOCKED config gate 503 pred overením podpisu. |
| URL `payment=success` sama nedáva oprávnenie | PASS v existujúcej serverovej politike/testoch. | BLOCKED, reálna DB/UI neoverená. |
| Platené oprávnenie vyžaduje aktívny stav a budúce obdobie | PASS v policy a SQL testoch. | BLOCKED, historické platené účty neprístupné. |
| Existujúce predplatné nevytvorí druhý checkout | PASS fixtures; kontrola pod lease a pred ním ostáva. | BLOCKED, reálny súbeh nebol vykonaný. |
| Retry a webhook duplicity sú idempotentné | PASS fixtures/PGlite vrátane strateného finalize. | BLOCKED, skutočné Stripe retry neoverené. |

## Databáza a prístupy

| Kontrola | Stav | Pozorovanie |
| --- | --- | --- |
| Identifikátory od vlastníka | ZAZNAMENANÉ | Lovable UUID `5e26db04-467c-4652-a9dc-c945b160d77c`; backend ref `pwftbssvdbjoblmhdeax`. |
| Lovable projekt cez konektor | BLOCKED | Lookup uvedeného UUID vrátil 404/project_not_found. |
| Supabase backend cez konektor | BLOCKED | Lookup uvedeného ref odmietol oprávnenie. Žiadny náhradný projekt nebol použitý. |
| Reálna história migrácií a subscriptions | BLOCKED | Neboli dostupné; duplicity, obdobia a historické mapovania sa nevymýšľali. |
| Opravená migrácia pripravená | PASS lokálne | Repozitár obsahuje konkrétny SQL diff a rozšírené testy. |
| Migrácia aplikovaná v izolovanom hosted test prostredí | BLOCKED | PGlite nie je hosted prostredie. |
| Produkčná migrácia aplikovaná a overená | BLOCKED | Bez autorizovaného prístupu a osobitného súhlasu sa nevykonala. |
| Reálne RLS/grants/RPC a privilegovaný runtime | BLOCKED | Lokálne PASS, ale reálna DB a runtime cesta nie sú overené. |

Verejná URL presmerovala na Lovable auth bridge s identifikátorom `lovp_6661rtv7wd9zqs9cyx1vhxeb5h`. Aj read-only lookup tohto pozorovaného ID vrátil 404. **Ekvivalencia s UUID od vlastníka nie je potvrdená**; nesmie sa podľa toho zameniť cieľ migrácie.

Lovable dokumentuje `SUPABASE_*` ako rezervované platformové hodnoty. Nie je potrebné získavať service-role key/DB heslo od používateľa a nemožnosť zobraziť secret nedokazuje jeho neprítomnosť. Treba overiť nasadenú serverovú cestu k RPC v správnom projekte. Generované typy sa ručne nemenili; po skutočnej migrácii ich regeneruje autorizovaný projektový postup.

## Pozorované HTTP správanie produkčnej URL

Kontrola **16. 11. 2026, 05:16 Europe/Bratislava**; neautentifikované GET a dve inertné POST požiadavky s telom `{}`. Žiadna platná Stripe udalosť ani platba sa neposlala.

| Požiadavka | Pozorovanie | Výsledok |
| --- | --- | --- |
| GET `/` | 302 na Lovable auth bridge, výsledný HTML titulok `Internal Lovable project`. | App UI BLOCKED. |
| GET `/settings/agency?tab=billing` | Rovnaký auth bridge; nevytvorila sa Customer Portal session. | Portál BLOCKED. |
| POST `/api/public/stripe-webhook` bez podpisu | 503 JSON `BILLING_WEBHOOK_NOT_CONFIGURED`, bez redirectu. | Dostupnosť routy PASS; konfigurácia FAIL. |
| POST webhooku so synteticky neplatným podpisom | Rovnaký 503 JSON. | Overenie neplatného podpisu BLOCKED konfiguráciou. |

Odpoveď dokazuje prístup k aplikačnej route a chybovú bránu konfigurácie. **Nedokazuje, ktorá konkrétna hodnota chýba**, ani aký commit je nasadený. HTTP odtlačok odpovede nie je Git SHA. GitHub → Lovable sync, publikovaná verzia a skutočné načítanie secrets zostávajú samostatne BLOCKED.

## Test-mode E2E — všetkých 20 požadovaných scenárov

Spoločná prekážka: dostupný Stripe prehliadač skončil na `/login`, nie v prihlásenom účte. Nebol dostupný izolovaný nakonfigurovaný test backend ani prihlásené testovacie účty aplikácie. Nebola založená testovacia platba, session ani zákazník. Jednotkové testy sa v tejto tabuľke nepočítajú ako E2E dôkaz.

| # | Scenár | Stav | Konkrétny chýbajúci dôkaz / prekážka |
| --- | --- | --- | --- |
| 1 | Free → Pro | BLOCKED | Žiadny autorizovaný test checkout/session ID. |
| 2 | Free → Agency na druhom účte | BLOCKED | Druhý test účet a session neboli dostupné. |
| 3 | Plán, 39/89 EUR, mena, daň | BLOCKED | Žiadna skutočná test Session/Price/Tax odpoveď. |
| 4 | Úspešná platba a správny návrat | BLOCKED | Žiadny Stripe test payment výsledok ani browser návrat. |
| 5 | Podpísaný webhook a dokončený ledger | BLOCKED | Config gate 503; reálny ledger neprístupný. |
| 6 | DB plán, status a current_period_end | BLOCKED | Správna hosted DB odmietla prístup. |
| 7 | Plán v UI po refreshi | BLOCKED | UI za auth bridge, chýba prihlásený test účet. |
| 8 | Prístup k platenej funkcii | BLOCKED | Žiadna reálna aktivácia/oprávnenie v test prostredí. |
| 9 | Customer Portal a faktúra | BLOCKED | Portal session a faktúra neboli vytvorené/otvorené. |
| 10 | Zamietnutie a 3DS | BLOCKED | Nepoužil sa oficiálny testovací platobný prostriedok. |
| 11 | Zatvorenie checkoutu bez aktivácie | BLOCKED | Žiadny otvorený test checkout. |
| 12 | Opakovaný klik bez duplicitného predplatného | BLOCKED | Iba fixture/SQL dôkazy, nie reálna Stripe subscription história. |
| 13 | Retry po výpadku bez druhej session | BLOCKED | Žiadny riadený výpadok v izolovanom hosted toku. |
| 14 | Opakovaný rovnaký webhook | BLOCKED | Reálne podpísané event ID sa neposlalo. |
| 15 | Staršia udalosť po novšej | BLOCKED | Neboli doručené dve skutočné test udalosti. |
| 16 | Zrušenie na konci obdobia a odobratie oprávnenia | BLOCKED | Žiadne test predplatné ani sledovanie konca obdobia. |
| 17 | Past_due a dostupný portál | BLOCKED | Nevytvoril sa test stav past_due ani portal session. |
| 18 | Druhý účet nesmie cudzie faktúry/billing zápisy | BLOCKED | Lokálne RLS PASS; dva reálne prihlásené účty neboli dostupné. |
| 19 | Odmietnutie cudzieho návratového originu | BLOCKED | Lokálny validator PASS; nasadená autentifikovaná funkcia nebola volaná. |
| 20 | Odmietnutie chýbajúceho/neplatného podpisu | BLOCKED | Oba nasadené negatívne POSTy skončili na 503 konfigurácie pred podpisovou kontrolou. |

## Live nastavenia a účtovníctvo

Ceny v implementácii ostali Pro **39 EUR/mesiac**, Agency **89 EUR/mesiac**. Konkrétne test/live Price ID sa nečítali z prihláseného účtu, preto neboli overené ich produkt, suma, EUR, monthly/interval_count 1, licensed/per_unit, inclusive, aktivita, režim ani prípadná metadata. Serverové kontroly týchto vlastností sú otestované lokálne. Live nesmie používať inline fallback.

Webhook sa musí nakonfigurovať s v1 snapshot udalosťami a verziou kompatibilnou s nasadeným SDK; test/live endpointy majú rozdielny signing secret. Povinných šesť udalostí a podporované doplnkové toky sú uvedené v runbooku. Ich dashboard nastavenie je BLOCKED.

Customer Portal treba overiť samostatne pre test/live: platobné metódy, faktúry, schválené rušenie a prípadný prechod Pro/Agency, quantity 1 bez ďalších items, proration a skutočné právne/obchodné údaje. Nič z toho sa nepovažuje za nastavené iba na základe existencie serverovej funkcie.

`STRIPE_AUTOMATIC_TAX_ENABLED=true` sa nenastavilo. Existujúca implementácia ho vyžaduje pre live checkout; pred aktiváciou treba súhlas s aktuálnymi podmienkami/poplatkami Stripe Tax a overiť predávajúceho, registrácie, produktovú kategóriu a lokalitu zákazníka. Nie je schválená univerzálna sadzba 20 % ani reverse charge iba podľa formátu IČ DPH. Inclusive cena musí zachovať verejnú sumu 39/89 EUR.

SuperFaktúra zostáva oddelená a vypnutá: `SUPERFAKTURA_INVOICING_ENABLED=false`, `SUPERFAKTURA_EMAIL_ENABLED=false` v šablóne/defaultoch. Reálne hodnoty produkčného secret store nie sú prístupné, takže ich stav sa netvrdí ako overený. Žiadna faktúra/e-mail sa neposlali.

## Presné odovzdanie pre Lovable agenta

1. Načítaj aktuálny `main`, tento report, AGENTS.md a runbook. Over, že obsah PR #15 je synchronizovaný. Neaplikuj pôvodný ZIP ani patch znova. V Lovable sandboxe rešpektuj jeho automatické build/typecheck kontroly.
2. Potvrď cez autorizované projektové metadata editor UUID, backend ref a pripojený repozitár. Neodvodzuj identitu z `current_database()` alebo podobného názvu. Pri nesúlade iba oznám rozdiel; nepouži iný projekt.
3. Spusti `docs/STRIPE_DB_CHECKS.sql` read-only proti správnej DB a vráť sanitizované počty/ACL. Voliteľný history SELECT odkomentuj až po potvrdení jeho tabuľky a stĺpca. Neexportuj customer IDs, emails, faktúry ani SQL telá z histórie.
4. Rozhodni podľa skutočnej histórie: ak `20261116031733` nebola aplikovaná, použije sa teraz opravený súbor. Ak už aplikovaná bola, nereplayuj CREATE TABLE; priprav následnú migráciu z reálneho stavu. Duplicity nemaž a `livemode` neodhaduj z `cus_`.
5. Priprav izolovaný hosted test backend a Stripe test mode s vlastným SITE_URL, callbackmi, webhookom a mapou zákazníkov. Over SQL, grants/RLS a privilegovanú serverovú RPC cestu; typy regeneruj autorizovaným postupom. Nežiadaj service-role key/DB heslo a neprepisuj rezervované Supabase bindings.
6. Doplň chýbajúce Stripe secrets cez bezpečný serverový secret formulár, nikdy chat/log/commit. Over schválené test Prices, webhook a portál. Zachovaj SuperFaktúra flagy false. Reálne business/tax/legal/cancellation/proration rozhodnutia, ktoré chýbajú, musí dodať vlastník.
7. Vykonaj všetkých 20 test-mode scenárov vyššie a prilož dôkazy z Session, event/ledger, DB a UI. Zaznamenávaj sanitizované odkazy a výsledky, nie secrets alebo osobné dáta.
8. **Až s konkrétnym preflightom a SQL požiadaj vlastníka o výslovné schválenie produkčnej migrácie.** To vyžaduje AGENTS.md aj aktuálne zadanie vlastníka; schválenie merge ho nenahrádza. Po schválení aplikuj v správnom projekte a zopakuj postmigration kontrolu.
9. Produkčné Stripe/Tax/portál nastavenia a publikovanie over po úspešnom test mode a príslušných schváleniach. Potvrď skutočný publikovaný commit. Reálnu skúšobnú platbu vykonaj až po výslovnom schválení sumy, účtu a platobného prostriedku; refund/zrušenie nerob automaticky.

**Najbližší krok je bod 1–3 v autorizovanom Lovable projekte, nie ďalšia aplikácia patchu.** Z tohto pripojenia je blokátorom prístup k projektu/backendu; na strane nasadenej aplikácie navyše pozorovaný webhook 503.

## Rollback a prevádzka

- Pri blokátore zastav vytváranie nových checkoutov cez serverový vstup/route alebo cielený deploy; skrytie UI tlačidla nestačí. Nenastavuj falošný úspech.
- Neodstraňuj spoločný Stripe API/webhook secret ako spôsob vypnutia predaja. Zachovaj webhook a správu existujúcich zákazníkov; bezdôvodne ich nevypínaj.
- Uprednostni kompatibilnú opravu smerom vpred. Rollback kódu nesmie dropnúť billing tabuľky, meniť vlastníctvo, vymazať faktúry/ledgery ani označiť udalosť `completed` na zakrytie chyby.
- Checkout pending nad 23 hodín, complete/unpaid alebo legacy bez operation UUID: dohľadaj skutočný Stripe výsledok podľa serverového mapovania a metadata, potom vykonaj kontrolovanú reconciliation. Nevytváraj druhú session a nezmaž operáciu naslepo.
- Pri duplicate customers/subscriptions, neplatných obdobiach alebo mode/owner konflikte priprav cielený plán opravy podľa skutočných Stripe dát; nikdy neodhaduj live režim podľa prefixu customer ID.
- Po obnove over webhook → ledger → subscriptions → entitlement → UI. URL návratu ani HTTP 200 samy nepotvrdzujú spracovanie platby.

## Primárne podklady

- [Stripe Checkout Session: status a payment_status](https://docs.stripe.com/api/checkout/sessions/object)
- [Supabase: explicitné grants a RLS](https://supabase.com/docs/guides/api/securing-your-api)
- [Lovable: secrets a rezervované SUPABASE_* názvy](https://docs.lovable.dev/features/secrets)
- [Runbook](docs/STRIPE_PRODUCTION_RUNBOOK.md), [SQL kontrola](docs/STRIPE_DB_CHECKS.sql), [secret šablóna](docs/stripe.env.example) a skutočné výsledky lokálnych kontrol uvedené vyššie.
