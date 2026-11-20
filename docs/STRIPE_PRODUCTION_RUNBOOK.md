# SEO4WEB — dokončenie Stripe a postup nasadenia

Stav k 16. 11. 2026: pôvodná Stripe implementácia a následná oprava SuperFaktúry sú na `main` cez PR #13 a #14. Tento postup ich dopĺňa; **pôvodný ZIP ani patch sa znovu neaplikuje**. Aktuálne dôkazy a blokátory sú v [STRIPE_FINALIZATION_REPORT.md](../STRIPE_FINALIZATION_REPORT.md). Zlúčenie kódu nie je potvrdenie zapnutej produkcie.

Repozitár: `youh4ck3dme/metaseopro`. Táto doplňujúca oprava vychádza z `main` na `4bd53b62e31215998ceec986c8b0df24e0fdc21b`; pred zásahom vždy načítaj aktuálny HEAD a zachovaj novšie zmeny. Cenník v `PLANS` je Pro **39 EUR/mesiac**, Agency **89 EUR/mesiac**; ceny sa nemenia.

## Čo sa zmenilo pre zákazníka

- Checkout zobrazí názov a cenu skutočne zvoleného plánu. Bez Stripe konfigurácie nevráti demo úspech.
- Existujúce alebo problémové predplatné sa spravuje cez Stripe Customer Portal; nevytvára sa druhé predplatné.
- Po skutočnom skončení predplatného možno začať nový nákup. Server preverí starú dokončenú session aj aktuálny stav jej predplatného v Stripe; nevybavená platba alebo nejasná história nový nákup naďalej zastaví.
- Portál je dostupný aj pri `past_due`, zrušenom predplatnom či aktuálnom Free oprávnení, ak účet má priradeného Stripe zákazníka.
- Chyba načítania fakturácie sa zobrazí s možnosťou obnovy. Nevymyslí stav Free/active.
- Pro/Agency oprávnenie vyžaduje `active` alebo `trialing` a budúci `current_period_end`. Kontrola platí aj pre generátor obsahových plánov po skončení 24-hodinového Free okna.
- Faktúry z webhooku sa ukladajú ako skutočné Stripe odkazy. SuperFaktúra export a odosielanie e-mailov zostávajú vypnuté.

## Rozhodnutia v implementácii

### Ceny a daň

V live režime sú oba Price ID povinné. Server overí EUR, cenu podľa `PLANS`, mesačnú periodicitu s intervalom 1, jednorazové množstvo 1, `licensed`, `per_unit`, aktívnu cenu a produkt, správny test/live režim a `tax_behavior=inclusive`. Ak produkt obsahuje `metadata.seo4web_plan`, musí súhlasiť. Autoritatívna mapa cien je serverová konfigurácia Price ID.

Inclusive režim zachováva verejne zobrazenú sumu 39/89 EUR. Zmenu na ceny bez DPH treba schváliť a zmeniť spoločne v UI aj Stripe. Daň sa nesmie potichu prirátať k doterajšej sume.

Táto implementácia používa pre live checkout Stripe Tax (`STRIPE_AUTOMATIC_TAX_ENABLED=true`). Prepínač nie je dôkazom správnej registrácie: treba nastaviť skutočného predávajúceho, jeho registrácie, produktovú tax kategóriu a spôsob určenia zákazníkovej lokality. Existujúci Stripe shipping address môže ovplyvniť výpočet a patrí do kontroly historických zákazníkov. Neaktivovať Tax ani platené služby bez kontroly aktuálnych podmienok účtu.

Nepoužívaj univerzálny predpoklad 20 % DPH ani jednu sadzbu pre všetkých zákazníkov. Konkrétny daňový postup musí vychádzať zo schválených údajov predávajúceho a zákazníka. Prenesenie daňovej povinnosti nevzniká len z prefixu alebo správneho formátu IČ DPH. VIES helper odlišuje pozitívne overenie, neplatnosť a nedostupnosť. Samotný Stripe Tax ani zber tax ID tu nie sú potvrdením VIES identity.

Formulár podporuje slovenské firemné identifikátory a Stripe zber daňových údajov. **Nevynucuje výlučne B2B obchod**: firemné polia sú voliteľné. Pred ostrým predajom musí prevádzkovateľ rozhodnúť, či obsluhuje aj B2C a aké overenie B2B vyžaduje. Nepoužiť povinné IČ DPH ako náhradu za právne overenie firmy.

### Vlastníctvo a návratové adresy

Používateľ neposiela `customer_id`, vlastníka, cenu ani stav predplatného. Vlastníka poskytuje existujúci auth middleware. Server číta priradenie zákazníka z jeho vlastného DB záznamu a overuje skutočný Stripe Customer, režim a prípadné owner metadata. Pri historickom Customer bez metadata sa spolieha na serverom spravované priradenie: pred migráciou sa musia overiť produkčné RLS/grants a história zápisov.

`SITE_URL` je serverový origin. Predvolený origin je `https://seo4web.lovable.app`; cesty checkout/portálu musia byť relatívne a zostať na rovnakom origine. Predvolený návrat z portálu je `/settings/agency?tab=billing`. HTTPS je povinné okrem explicitného lokálneho vývoja. Browser auth naďalej používa aktuálny origin pre preview/lokálny/custom domain.

### Trvalý stav platieb

Migrácia zavádza mapu zákazníkov, checkout operácie a request aliasy, webhook ledger a referencie faktúr. Všetky mutácie ledgerov sú iba service-role RPC. Zákazník má jeden spoločný 180-sekundový lease pre checkout a webhook.

Päť nových billing tabuliek má UUID vlastníka bez novej väzby do spravovanej schémy `auth.users`. Pôvodné PK/NOT NULL a štyri vzťahy medzi billing tabuľkami zostávajú. Každé CREATE TABLE má bezprostredne explicitné REVOKE/GRANT pred RLS. Pri faktúrach má `authenticated` iba SELECT vlastných riadkov; ostatné nové tabuľky a mutačné RPC sú iba pre `service_role`. Vymazanie auth účtu preto automaticky nemaže nové billing záznamy. Prípadné uzavretie účtu a uchovanie účtovných údajov vyžaduje samostatný prevádzkový postup.

Server vypočíta SHA-256 parametrov checkoutu. Operácia vznikne v DB pred volaním Stripe a jej UUID je Stripe idempotency key. Po neistej chybe sa UUID nezmaže. Opakovanie rovnakého vstupu pokračuje s rovnakou operáciou; iný vstup sa pri nevyriešenej operácii odmietne. Po 23 hodinách sa zastaví slepé opakovanie, aby sa neprekročila bežná retenčná hranica Stripe idempotency záznamov. Taký stav vyžaduje dohľadanie session v Stripe.

Finálny DB zápis kontroluje token a generáciu lease. Webhook označí udalosť ako dokončenú v rovnakej transakcii, ktorá uloží aktuálne predplatné. Udalosti sa netriedia iba podľa `event.created`: po získaní lease sa načíta aktuálny stav zo Stripe. Stará udalosť o zrušení nesmie zrušiť novšie predplatné. Nejasný stav, viac súčasných predplatných alebo neúplná stránkovaná história sa zastaví na kontrolu.

Historická Checkout Session môže zostať `complete` aj po skončení predplatného. Nová operácia ju smie prekročiť iba pri odlišnom platnom `metadata.checkoutOperationId`, stave platby `paid`/`no_payment_required` a opätovne načítanom predplatnom `canceled`/`incomplete_expired` so zhodným vlastníkom, customer a režimom. Rovnaká dokončená operácia, `unpaid`, chýbajúce historické metadata a neukončené predplatné zostávajú blokované. SQL uchováva starý session pointer pre kontrolu otvorených session a ochranu pred duplicitami.

## Nasadenie krok za krokom

1. **Identifikuj správny projekt.** Vlastník uviedol editor `https://lovable.dev/projects/5e26db04-467c-4652-a9dc-c945b160d77c` a backend `pwftbssvdbjoblmhdeax`. Over ich v autorizovanom Lovable prostredí spolu s pripojeným repozitárom. Konektor pri tejto kontrole vrátil pre projekt 404 a pre backend odmietnutie prístupu. Verejná aplikácia presmerovala na auth bridge s iným interným identifikátorom; tento alias nie je dôkazom totožnosti projektov. Nevybrať náhradný projekt podľa názvu a nežiadať DB heslo či service-role kľúč.
2. **Prever aktuálny main a diff.** Načítaj aktuálnu vetvu a otvorené PR; zachovaj cudzie pracovné zmeny. Táto implementácia je súčasťou repozitára. Neaplikuj pôvodný ZIP/patch znova. Over samostatne GitHub → Lovable sync a skutočne publikovaný commit.
3. **Over DB preflight.** Použi [STRIPE_DB_CHECKS.sql](STRIPE_DB_CHECKS.sql) cez autorizované pripojenie, najskôr v izolovanom testovacom projekte. Skript používa read-only transakciu, katalógy a agregované počty. Over históriu migrácií, grants/RLS, status CHECK, duplicity customer/subscription ID, platené účty s neplatným obdobím a historické mapovania. Projekt má Supabase aj Drizzle históriu; nespúšťaj obidve naslepo. Cieľová migrácia je `supabase/migrations/20261116031733_stripe_billing_reconciliation.sql`. Ak je jej verzia už aplikovaná, nereplayuj CREATE TABLE; priprav následnú migráciu podľa skutočného stavu a samostatne ju over. Úprava pripraveného SQL súboru sama existujúcu DB nemení.
4. **Schváľ produkčnú migráciu.** Repo `AGENTS.md` aj zadanie vlastníka vyžadujú explicitné schválenie produkčnej migrácie. Predlož konkrétny SQL diff, výsledok preflightu a testov. Najprv ju aplikuj a over v izolovanom neprodukčnom prostredí. Existujúce Customer ID nebackfillovať s odhadnutým `livemode`; over každého v Stripe a potom použi autorizovaný serverový postup s `billing_link_customer`. Duplicity ani chýbajúce obdobia nemaž automaticky. Pri chýbajúcom prístupe označ aplikovanie a overenie BLOCKED.
5. **Nastav test-mode Stripe produkty.** Vytvor Pro 39 EUR a Agency 89 EUR mesačne, inclusive. Over aktívne produkty a správne Price ID. Test inline fallback existuje iba v test mode; live sa oň neoprie. Test/live ceny a zákazníci nepatria do tej istej databázovej mapy bez riadenej migrácie.
6. **Nastav tajomstvá.** Podľa `docs/stripe.env.example` doplň iba potrebné Stripe hodnoty do serverového secret store príslušného test/live prostredia. Neprepisuj existujúce hodnoty prázdnou šablónou. Lovable rezervuje a spravuje `SUPABASE_*`; tieto premenné nepridávaj ani neprepisuj ručne. Over, že nasadená serverová integrácia má autorizovaný prístup k service-role-only RPC. Verejný/anon klient ho nenahradí a nemožnosť zobraziť secret sama nepreukazuje jeho neprítomnosť. Žiadny secret nemá prefix `VITE_`; nevkladaj kľúče do chatu, logu, commitu ani ZIPu. Izolované testovacie nasadenie musí mať vlastný `SITE_URL`, callbacky, webhook a DB mapu zákazníkov; produkčný origin zostáva `https://seo4web.lovable.app`.
7. **Nastav webhook.** URL: `https://seo4web.lovable.app/api/public/stripe-webhook`. Povinné udalosti: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`. Podporované sú aj `customer.subscription.paused` a `customer.subscription.resumed` pre zodpovedajúce zmeny stavu. Implementácia podporuje aj `invoice.paid`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`; zapni ich, ak príslušné toky používaš. Endpoint používa v1 snapshot udalosti; neprepínaj ho na v2 thin formát. Secret patrí presnému endpointu a režimu. Verziu webhook eventov zosúlaď s nasadeným SDK a otestuj podpísané fixtures; zmena verzie SDK nemení automaticky dashboard endpoint.
8. **Nastav Customer Portal samostatne pre test/live.** Povoľ správu platobnej metódy, históriu faktúr a dohodnutý spôsob zrušenia. Prepínanie plánov zapni až po pridaní oboch schválených cien; množstvo ponechaj pevne 1 a nepovoľuj pridávanie ďalších subscription items; vyskúšaj proration a zmeny v ďalšom období. Ulož skutočné právne odkazy, obchodné údaje a support kontakt. Portal sessions sa vytvárajú na požiadanie, nie ako trvalý odkaz.
9. **Vykonaj testovací tok.** Úspešný checkout, 3DS, zamietnutie, zatvorenie checkoutu, opakovaný klik, retry po simulovanom výpadku, obnovenie platby v portáli, zrušenie ihneď/na konci obdobia a výmena plánov. Zopakuj identickú podpísanú udalosť a doruč staršiu až po novej. Over row ownership druhým účtom. Dokončenie sa dokazuje DB stavom a skutočným Stripe výsledkom, nie URL `payment=success`.
10. **Over live konfiguráciu.** Až po kontrole predávajúceho, daní, cien, endpointu a portálu nahraď testové secrets live hodnotami v správnom prostredí. Ak je potrebná reálna skúšobná platba, dohodni jej sumu a platobný prostriedok s vlastníkom účtu; tento patch žiadnu nespustil.
11. **Spusti brány a publikuj.** Pozri nižšie. Existujúca výnimka vlastníka pokrýva 349 lint chýb v nezmenených súboroch; zmenené súbory musia byť bez lint chýb. Podpis výsledného commitu over a uveď skutočný spôsob podpisu; API commit na pracovnej vetve nie je lokálny GPG podpis vlastníka. Po merge samostatne over Lovable sync, publikovanú verziu, dostupnosť webhooku a živé správanie portálu. Pri kontrole 16. 11. 2026 webhook vrátil `503 BILLING_WEBHOOK_NOT_CONFIGURED`; táto odpoveď nie je dôkazom overenia podpisu ani funkčnej platby.

## Kontroly

Použi Bun a uzamknuté závislosti. V tomto pracovnom prostredí bol Bun 1.4.4; prípadný odlišný runtime musí prejsť rovnakými kontrolami.

```bash
bun install --frozen-lockfile
bunx vitest run
bunx tsc --noEmit
bun run lint
bun run build
git diff --check
```

Existujúca uzamknutá PGlite závislosť spúšťa PostgreSQL SQL, constraints, RLS a sekvenčné prekladanie lease operácií v teste. Nie je to pripojenie k produkčnému Supabase ani dôkaz súbehu na viacerých DB spojeniach. Stripe/Customer Portal testy používajú fixtures bez platby. Existujúce e2e testy môžu pri neprítomnom serveri návrat preskočiť; samotný počet unit testov nie je E2E dôkaz.

Aktuálny počet a výsledok každého behu je v `STRIPE_FINALIZATION_REPORT.md`; historické počty sa nepoužívajú ako dôkaz nového behu. Generované Supabase súbory sa ručne nemenia a pravidlá sa nevypínajú iba kvôli zelenému výsledku. Typy po migrácii regeneruj iba autorizovaným projektovým postupom. V Lovable sandboxe rešpektuj jeho automatické build/typecheck kontroly a zákaz manuálnych alternatív, ak ho prostredie stanovuje.

## Čo zostáva zámerne nezapnuté

SuperFaktúra adapter odstránil vymyslené úspechy a neoverené daňové predpoklady, ale **nie je dokončeným účtovným pipeline**. Chýba dôveryhodný uložený tax review, outbox, business idempotencia a dohľadanie výsledku po páde za externým create, settlement a evidencia doručenia. `VerifiedTaxDecision` kontroluje tvar, nie právnu správnosť ani existenciu záznamu v DB. Preto webhook tento adapter nevolá a oba jeho feature flagy zostávajú `false`.

Vytvorenie faktúry nepotvrdzuje odoslanie e-mailu. `sendInvoiceEmail` vracia samostatný stav: `accepted` (poskytovateľ potvrdil požiadavku pre zhodné ID faktúry a príjemcu), `mock` (izolovaný test), `not_sent` (požiadavka sa neodoslala alebo ju poskytovateľ odmietol) alebo `unknown` (výsledok nie je potvrdený). `accepted` nie je dôkazom doručenia do schránky. Pri `unknown` je `requiresReconciliation: true`; pred opakovaním treba výsledok dohľadať u poskytovateľa, nie vytvoriť ďalšiu faktúru alebo naslepo poslať ďalší e-mail. Potvrdenie o vytvorení obsahuje samostatnú nemennú kópiu klienta a identitu poskytovateľa (origin a company ID), ktoré sa pri odoslaní kontrolujú. Toto potvrdenie musí pochádzať z dôveryhodného serverového úložiska; samotný JSON objekt nedokazuje autenticitu ani oprávnenie používateľa.

Pre účtovné vystavovanie treba samostatne rozhodnúť, či autoritatívna faktúra vzniká v Stripe alebo v SuperFaktúre. Nevystavovať dve daňové faktúry na jednu transakciu bez odsúhlaseného účtovného postupu.

Existujúce read/update počítadlo použití Content Planu nie je atomické a môže stratiť prírastky pri súbehu; táto oprava mení oprávnenie, nie tento analytický counter. Lokálne browser click-through, skutočné Stripe platby, deploy, produkčné migrácie ani účtovné e-maily nie sú dôsledkom samotného spustenia testov.

## Prevádzkové obnovenie

- Retry webhooku je vhodný pri nedostupnej DB/Stripe, `busy` lease alebo stratenom finalize. Nikdy neoznačovať ledger manuálne `completed`, aby sa skryla chyba.
- Pri pending checkout operácii nad 23 hodín najprv dohľadaj skutočný Stripe výsledok podľa customer a `metadata.checkoutOperationId`; nevytváraj novú session naslepo. Obnovu z potvrdenej Checkout Session vie dokončiť príslušný webhook. Bez session výsledku je potrebná cielená administrátorská reconciliation, nie mazanie ledgerov.
- Pri viac aktívnych predplatných, neznámej cene alebo konflikte vlastníka zastav nové checkouty pre dotknutý účet a skontroluj zdrojové dáta. Nedowngraduj náhodne vybraný záznam.
- Ak treba vypnúť nové predaje, zastav vstup do checkoutu na serverovej routovacej vrstve alebo nasaď cielenú opravu checkoutu. Samotné skrytie tlačidla nezablokuje priame volanie. Nemaž spoločný `STRIPE_SECRET_KEY` ani webhook secret: poškodil by sa webhook a správa existujúcich zákazníkov. Preferuj opravu smerom vpred; rollback iba na kompatibilnú overenú implementáciu bez mazania billing tabuliek, histórie či ledgerov. Nerob návrat na starý webhook, ktorý bez konfigurácie odpovedá falošným HTTP 200.

## Primárne referencie overené pri práci

- Stripe Checkout subscriptions: https://docs.stripe.com/payments/checkout/build-subscriptions
- Stripe Checkout Session status/payment_status: https://docs.stripe.com/api/checkout/sessions/object
- Stripe Customer Portal: https://docs.stripe.com/customer-management/integrate-customer-portal
- Stripe webhooks: https://docs.stripe.com/webhooks
- Stripe idempotency: https://docs.stripe.com/api/idempotent_requests
- Stripe Tax behavior: https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
- Stripe Tax checkout: https://docs.stripe.com/tax/checkout/page
- Stripe tax ID validation: https://docs.stripe.com/billing/customer/tax-ids
- Slovenské sadzby DPH: https://podpora.financnasprava.sk/525847-V%C5%A1eobecn%C3%A9-inform%C3%A1cie
- Supabase changelog: https://supabase.com/changelog
- Supabase explicit grants a RLS: https://supabase.com/docs/guides/api/securing-your-api
- Lovable reserved secrets: https://docs.lovable.dev/features/secrets
- PGlite API: https://pglite.dev/docs/api
