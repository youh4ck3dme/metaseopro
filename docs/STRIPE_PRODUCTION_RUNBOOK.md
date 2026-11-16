# SEO4WEB — pripravená oprava Stripe a postup nasadenia

Stav k 16. 11. 2026: implementácia je pripravená na lokálne overenie a review. **Nie je to potvrdenie zapnutej produkcie.** Výsledky vykonaných kontrol sú v priloženom release reporte.

Východisko: `youh4ck3dme/metaseopro`, `main` na `794da93fdd282e80f7522762206159beaedb68f0`. Lokálna vetva: `fix/stripe-production-readiness`. Pôvodný cenník v `PLANS` je Pro **39 EUR/mesiac**, Agency **89 EUR/mesiac**. Táto oprava nemení ceny na 29 EUR.

## Čo sa zmenilo pre zákazníka

- Checkout zobrazí názov a cenu skutočne zvoleného plánu. Bez Stripe konfigurácie nevráti demo úspech.
- Existujúce alebo problémové predplatné sa spravuje cez Stripe Customer Portal; nevytvára sa druhé predplatné.
- Portál je dostupný aj pri `past_due`, zrušenom predplatnom či aktuálnom Free oprávnení, ak účet má priradeného Stripe zákazníka.
- Chyba načítania fakturácie sa zobrazí s možnosťou obnovy. Nevymyslí stav Free/active.
- Pro/Agency oprávnenie vyžaduje `active` alebo `trialing` a budúci `current_period_end`. Kontrola platí aj pre generátor obsahových plánov po skončení 24-hodinového Free okna.
- Faktúry z webhooku sa ukladajú ako skutočné Stripe odkazy. SuperFaktúra export a odosielanie e-mailov zostávajú vypnuté.

## Rozhodnutia v implementácii

### Ceny a daň

V live režime sú oba Price ID povinné. Server overí EUR, cenu podľa `PLANS`, mesačnú periodicitu s intervalom 1, jednorazové množstvo 1, `licensed`, `per_unit`, aktívnu cenu a produkt, správny test/live režim a `tax_behavior=inclusive`. Ak produkt obsahuje `metadata.seo4web_plan`, musí súhlasiť. Autoritatívna mapa cien je serverová konfigurácia Price ID.

Inclusive režim zachováva verejne zobrazenú sumu 39/89 EUR. Zmenu na ceny bez DPH treba schváliť a zmeniť spoločne v UI aj Stripe. Daň sa nesmie potichu prirátať k doterajšej sume.

Táto implementácia používa pre live checkout Stripe Tax (`STRIPE_AUTOMATIC_TAX_ENABLED=true`). Prepínač nie je dôkazom správnej registrácie: treba nastaviť skutočného predávajúceho, jeho registrácie, produktovú tax kategóriu a spôsob určenia zákazníkovej lokality. Existujúci Stripe shipping address môže ovplyvniť výpočet a patrí do kontroly historických zákazníkov. Neaktivovať Tax ani platené služby bez kontroly aktuálnych podmienok účtu.

Pôvodných 20 % je zastaraný všeobecný predpoklad. Slovenská základná sadzba je 23 %, ale kód ju automaticky nevnucuje každému zákazníkovi. Prenesenie daňovej povinnosti nevzniká len z prefixu alebo správneho formátu IČ DPH. VIES helper odlišuje pozitívne overenie, neplatnosť a nedostupnosť. Samotný Stripe Tax ani zber tax ID tu nie sú potvrdením VIES identity.

Formulár podporuje slovenské firemné identifikátory a Stripe zber daňových údajov. **Nevynucuje výlučne B2B obchod**: firemné polia sú voliteľné. Pred ostrým predajom musí prevádzkovateľ rozhodnúť, či obsluhuje aj B2C a aké overenie B2B vyžaduje. Nepoužiť povinné IČ DPH ako náhradu za právne overenie firmy.

### Vlastníctvo a návratové adresy

Používateľ neposiela `customer_id`, vlastníka, cenu ani stav predplatného. Vlastníka poskytuje existujúci auth middleware. Server číta priradenie zákazníka z jeho vlastného DB záznamu a overuje skutočný Stripe Customer, režim a prípadné owner metadata. Pri historickom Customer bez metadata sa spolieha na serverom spravované priradenie: pred migráciou sa musia overiť produkčné RLS/grants a história zápisov.

`SITE_URL` je serverový origin. Predvolený origin je `https://seo4web.lovable.app`; cesty checkout/portálu musia byť relatívne a zostať na rovnakom origine. Predvolený návrat z portálu je `/settings/agency?tab=billing`. HTTPS je povinné okrem explicitného lokálneho vývoja. Browser auth naďalej používa aktuálny origin pre preview/lokálny/custom domain.

### Trvalý stav platieb

Migrácia zavádza mapu zákazníkov, checkout operácie a request aliasy, webhook ledger a referencie faktúr. Všetky mutácie ledgerov sú iba service-role RPC. Zákazník má jeden spoločný 180-sekundový lease pre checkout a webhook.

Server vypočíta SHA-256 parametrov checkoutu. Operácia vznikne v DB pred volaním Stripe a jej UUID je Stripe idempotency key. Po neistej chybe sa UUID nezmaže. Opakovanie rovnakého vstupu pokračuje s rovnakou operáciou; iný vstup sa pri nevyriešenej operácii odmietne. Po 23 hodinách sa zastaví slepé opakovanie, aby sa neprekročila bežná retenčná hranica Stripe idempotency záznamov. Taký stav vyžaduje dohľadanie session v Stripe.

Finálny DB zápis kontroluje token a generáciu lease. Webhook označí udalosť ako dokončenú v rovnakej transakcii, ktorá uloží aktuálne predplatné. Udalosti sa netriedia iba podľa `event.created`: po získaní lease sa načíta aktuálny stav zo Stripe. Stará udalosť o zrušení nesmie zrušiť novšie predplatné. Nejasný stav, viac súčasných predplatných alebo neúplná stránkovaná história sa zastaví na kontrolu.

## Nasadenie krok za krokom

1. **Identifikuj správny projekt.** Potrebný je editor link `https://lovable.dev/projects/...`, nie iba verejná URL. V aktuálne pripojených Lovable projektoch SEO4WEB nebolo. `supabase/config.toml` ukazuje `pwftbssvdbjoblmhdeax`; tento projekt nebol v dostupnom Supabase konektore. Nevybrať iný projekt podľa podobného názvu.
2. **Prever aktuálny main a diff.** Patch je pripravený na uvedený SHA. Pri odlišnom HEAD použi `git apply --check`, vyrieš konflikty cielene a zopakuj kontroly. Nenahrádzať celý projekt ZIP súbormi naslepo.
3. **Over DB preflight.** Prečítaj reálne migrácie, grants/RLS, status CHECK, duplicity `stripe_customer_id` a `stripe_subscription_id`, nulové obdobia platených plánov a historické účty. Projekt má Supabase aj Drizzle históriu; tieto sa nesmú slepo spúšťať oba. Nová migrácia je `supabase/migrations/20261116031733_stripe_billing_reconciliation.sql` vytvorená Supabase CLI 3.1.0.
4. **Schváľ produkčnú migráciu.** Repo `AGENTS.md` vyžaduje explicitné schválenie produkčných migrácií. Najprv ju aplikuj v overenom neprodukčnom prostredí. Existujúce Customer ID nebackfillovať s odhadnutým `livemode`; over každého v Stripe a potom vykonaj `billing_link_customer`. Duplicity ani chýbajúce obdobia nepremenovať či nemaž automaticky.
5. **Nastav test-mode Stripe produkty.** Vytvor Pro 39 EUR a Agency 89 EUR mesačne, inclusive. Over aktívne produkty a správne Price ID. Test inline fallback existuje iba v test mode; live sa oň neoprie. Test/live ceny a zákazníci nepatria do tej istej databázovej mapy bez riadenej migrácie.
6. **Nastav tajomstvá.** Zlúč kľúče z `docs/stripe.env.example` do existujúceho secret store. Neprepíš ostatnú konfiguráciu projektu. Žiadny secret nemá prefix `VITE_`; nevkladaj kľúče do chatu, commitu ani ZIPu.
7. **Nastav webhook.** URL: `https://seo4web.lovable.app/api/public/stripe-webhook`. Povinné udalosti: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`. Podporované sú aj `customer.subscription.paused` a `customer.subscription.resumed` pre zodpovedajúce zmeny stavu. Implementácia podporuje aj `invoice.paid`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`; zapni ich, ak príslušné toky používaš. Endpoint používa v1 snapshot udalosti; neprepínaj ho na v2 thin formát. Secret patrí presnému endpointu a režimu. Verziu webhook eventov zosúlaď s nasadeným SDK a otestuj podpísané fixtures; zmena verzie SDK nemení automaticky dashboard endpoint.
8. **Nastav Customer Portal samostatne pre test/live.** Povoľ správu platobnej metódy, históriu faktúr a dohodnutý spôsob zrušenia. Prepínanie plánov zapni až po pridaní oboch schválených cien; množstvo ponechaj pevne 1 a nepovoľuj pridávanie ďalších subscription items; vyskúšaj proration a zmeny v ďalšom období. Ulož skutočné právne odkazy, obchodné údaje a support kontakt. Portal sessions sa vytvárajú na požiadanie, nie ako trvalý odkaz.
9. **Vykonaj testovací tok.** Úspešný checkout, 3DS, zamietnutie, zatvorenie checkoutu, opakovaný klik, retry po simulovanom výpadku, obnovenie platby v portáli, zrušenie ihneď/na konci obdobia a výmena plánov. Zopakuj identickú podpísanú udalosť a doruč staršiu až po novej. Over row ownership druhým účtom. Dokončenie sa dokazuje DB stavom a skutočným Stripe výsledkom, nie URL `payment=success`.
10. **Over live konfiguráciu.** Až po kontrole predávajúceho, daní, cien, endpointu a portálu nahraď testové secrets live hodnotami v správnom prostredí. Ak je potrebná reálna skúšobná platba, dohodni jej sumu a platobný prostriedok s vlastníkom účtu; tento patch žiadnu nespustil.
11. **Spusti brány a publikuj.** Pozri nižšie. Pri zlyhaní neoznačuj release za zelený. GPG podpis neobchádzaj unsigned commitom. Po pushi samostatne over Lovable sync, publikovanú verziu, dostupnosť webhooku a živé správanie portálu.

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

Nový PGlite dev dependency 0.5.16 spúšťa PostgreSQL SQL, constraints, RLS a sekvenčné prekladanie lease operácií v teste. Nie je to pripojenie k produkčnému Supabase ani dôkaz súbehu na viacerých DB spojeniach. Stripe/Customer Portal testy používajú fixtures bez platby. Existujúce e2e testy môžu pri neprítomnom serveri návrat preskočiť; samotný počet unit testov nie je E2E dôkaz.

Pred opravou: 188 testov, TypeScript a build prešli; lint mal 351 chýb formátovania a 9 warnings. Najviac chýb bolo v generovaných Supabase súboroch. Tie sa ručne nemenia a pravidlá sa nevypínajú iba kvôli zelenému výsledku. Skutočný výsledok po oprave je v release reporte.

## Čo zostáva zámerne nezapnuté

SuperFaktúra adapter odstránil vymyslené úspechy a neoverené daňové predpoklady, ale **nie je dokončeným účtovným pipeline**. Chýba dôveryhodný uložený tax review, outbox, business idempotencia a dohľadanie výsledku po páde za externým create, settlement a evidencia doručenia. `VerifiedTaxDecision` kontroluje tvar, nie právnu správnosť ani existenciu záznamu v DB. Preto webhook tento adapter nevolá a oba jeho feature flagy zostávajú `false`.

Pre účtovné vystavovanie treba samostatne rozhodnúť, či autoritatívna faktúra vzniká v Stripe alebo v SuperFaktúre. Nevystavovať dve daňové faktúry na jednu transakciu bez odsúhlaseného účtovného postupu.

Existujúce read/update počítadlo použití Content Planu nie je atomické a môže stratiť prírastky pri súbehu; táto oprava mení oprávnenie, nie tento analytický counter. Lokálne browser click-through, skutočné Stripe platby, deploy, produkčné migrácie ani účtovné e-maily nie sú dôsledkom samotného spustenia testov.

## Prevádzkové obnovenie

- Retry webhooku je vhodný pri nedostupnej DB/Stripe, `busy` lease alebo stratenom finalize. Nikdy neoznačovať ledger manuálne `completed`, aby sa skryla chyba.
- Pri pending checkout operácii nad 23 hodín najprv dohľadaj skutočný Stripe výsledok podľa customer a `metadata.checkoutOperationId`; nevytváraj novú session naslepo. Obnovu z potvrdenej Checkout Session vie dokončiť príslušný webhook. Bez session výsledku je potrebná cielená administrátorská reconciliation, nie mazanie ledgerov.
- Pri viac aktívnych predplatných, neznámej cene alebo konflikte vlastníka zastav nové checkouty pre dotknutý účet a skontroluj zdrojové dáta. Nedowngraduj náhodne vybraný záznam.
- Ak treba vypnúť nové predaje, odstráň/odpoj checkout secret v príslušnom deploy alebo vypni platobný vstup. Zachovaj funkčný webhook a správu existujúcich predplatných tam, kde je to možné. Nerob návrat na starý webhook, ktorý bez konfigurácie odpovedá falošným HTTP 200.

## Primárne referencie overené pri práci

- Stripe Checkout subscriptions: https://docs.stripe.com/payments/checkout/build-subscriptions
- Stripe Customer Portal: https://docs.stripe.com/customer-management/integrate-customer-portal
- Stripe webhooks: https://docs.stripe.com/webhooks
- Stripe idempotency: https://docs.stripe.com/api/idempotent_requests
- Stripe Tax behavior: https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
- Stripe Tax checkout: https://docs.stripe.com/tax/checkout/page
- Stripe tax ID validation: https://docs.stripe.com/billing/customer/tax-ids
- Slovenské sadzby DPH: https://podpora.financnasprava.sk/525847-V%C5%A1eobecn%C3%A9-inform%C3%A1cie
- Supabase changelog: https://supabase.com/changelog
- PGlite API: https://pglite.dev/docs/api
