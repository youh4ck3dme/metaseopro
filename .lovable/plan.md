# Content Decay Radar — Implementation Plan

A new MVP feature at `/decay` that finds decaying URLs from Google Search Console and generates an AI SEO refresh plan per URL. Reuses existing auth, rate-limit, SSE streaming, cards, history, and nav. No existing feature changes behavior.

## Architecture decisions (from your answers)
- **GSC access (MVP):** Lovable **Google Search Console connector** via the secure server-side gateway. Tokens never reach the browser, no token table needed. Server reads the connected account's properties. Clean path to Phase 2 (per-user OAuth) and Phase 3 (scheduled scans) later.
- **Two modes, never mixed:**
  - **LIVE** — real GSC data, badge `Live Data`.
  - **DEMO** — clearly-labeled simulated datasets (Blog, Ecommerce, Local Business, SaaS), banner: *"Demo dataset – connect Google Search Console for real analysis."* Full workflow works in demo. Every AI output explicitly states it is based on demo data.

## New routes
```text
/decay                          page (UI route, auth-gated client-side like /raketa)
/api/decay/gsc-properties       POST  JSON  (list connected GSC sites)
/api/decay/analyze              POST  JSON  (current vs previous period decay)
/api/decay/generate-refresh-plan POST SSE   (stream AI plan, save to history)
```

## New files
- `src/lib/decay-schema.ts` — shared Zod schemas + TS types: `AnalyzeBodySchema`, `GeneratePlanBodySchema`, `DecayRow`, `DecayType`, `Priority`, comparison windows (`28` / `90`), languages (`sk`/`cs`/`en`), mode (`live`/`demo`). Pure, client+server safe.
- `src/lib/gsc.server.ts` — server-only GSC gateway client. `listSites()` and `searchAnalytics()` calling `https://connector-gateway.lovable.dev/google_search_console/webmasters/v3/...` with `Authorization: Bearer LOVABLE_API_KEY` + `X-Connection-Api-Key: GOOGLE_SEARCH_CONSOLE_API_KEY`. Detects "not connected" (missing key) / 401 (reconnect) / 403 (permission) / empty (no properties) and maps to typed results. Read-only only.
- `src/lib/decay-analyze.server.ts` — fetches current + previous period `["page"]` rows (rowLimit 25000, type web, byPage), joins by URL, computes all metrics + `decay_type` + `priority_score`; for top 20 decayed URLs fetches `["page","query"]` to derive `top_lost_queries` / opportunity queries. Recommended action heuristic (refresh/expand/merge/redirect/improve meta/internal links/leave alone).
- `src/lib/decay-demo.ts` — 4 realistic labeled demo datasets (blog, ecommerce, local, saas) producing the same `DecayRow[]` shape so UI/AI are identical to live.
- `src/lib/decay-prompt.ts` — system + user prompt builder for the refresh plan (Diagnosis, main cause, intent shift, new title/meta/H1, outline, missing H2/H3, FAQ/AEO, internal links, rewrite instructions, risky claims, CTA, publishing checklist, expected impact as **odhad** with stated uncertainty). Hard guardrails: no ranking promises, no invented search volume/sources, demo-mode disclosure line.
- `src/routes/api/decay-properties.ts` — `/api/decay/gsc-properties`.
- `src/routes/api/decay-analyze.ts` — `/api/decay/analyze`.
- `src/routes/api/decay-generate.ts` — `/api/decay/generate-refresh-plan` (SSE, saves to `generated_outputs`).
- `src/routes/decay.tsx` — the page.

## Edited files
- `src/components/AppHeader.tsx` — add `{ to: "/decay", label: "Decay Radar" }` to `NAV` (desktop + mobile both render from `NAV`, so one edit covers both).
- `src/lib/outputs.functions.ts` — extend `SaveSchema.type` enum with `"decay"`.
- `src/routes/history.tsx` — add `decay` to `FilterType`, `Item["type"]`, `TYPE_LABEL` ("Decay Radar"), `TYPE_ICON` (e.g. `Activity`/`TrendingDown`), and the filter button list.

## Endpoint behavior & security (mirrors existing routes)
All three `/api/decay/*` handlers:
- `requireUser(request)` (Supabase JWT) → 401 if not authed.
- `content-length` body cap (8KB analyze/properties, ~48KB generate).
- `checkRateLimit("decay-*:{userId}", ...)` → 429 with Retry-After.
- Zod validation of body → 400 on failure.
- try/catch → generic 500 message, real error only `console.error` (no stack to client).

Mode handling:
- `gsc-properties`: if connector key missing/unauthorized → returns `{ status: "not_connected" | "reconnect" | "no_properties" | "permission_error", sites: [] }` so UI renders the right connection-card state. Returns only `siteUrl` + `permissionLevel`.
- `analyze` / `generate`: accept `mode`. In `demo` mode, bypass GSC entirely and use `decay-demo.ts` (so it works with no connector). In `live` mode require a valid connected property; on token issues return a typed reconnect error.
- Generate saves to `generated_outputs`: `type:"decay"`, `title:"Content Decay Radar: {URL}"`, `output_markdown`, `input` metadata = `{ property, url, period, mode, score, lostClicks, topQueries }`. **No GSC tokens ever placed in `input`/output or returned to client; no tokens in localStorage.**

## `/decay` page UI (Slovak, reuses existing card/button styles)
- `AppHeader` + `Toaster`, client-side auth redirect to `/login?redirect=/decay` (same pattern as `/raketa`).
- **Hero:** title "Content Decay Radar", subtitle "Nájdi články, ktoré kedysi ťahali traffic a dnes pomaly hnijú v SERPe.", CTAs "Pripojiť Google Search Console" + "Spustiť analýzu".
- **Connection card** with states: not connected / connecting / connected (property selector + permission level + last sync) / token expired (reconnect) / no properties / permission error. Demo banner shown when in demo mode.
- **Analysis form:** property select, window (28v28 default / 90v90), min impressions (default 50), URL-contains filter, include-query-level checkbox (default on), language (sk default / cs / en).
- **Results:**
  - A. Summary cards: pages analyzed, pages with decay, estimated lost clicks (labeled odhad), highest-opportunity page, critical decay count.
  - B. Decay table: URL, decay type, lost clicks, impressions Δ, CTR Δ, position Δ, priority, action button "Vygenerovať refresh plán".
  - C. URL detail drawer (right panel like history): current vs previous metrics, top lost queries, top opportunity queries, recommended action.
  - D. AI refresh plan: SSE stream via existing `streamSSE`, render markdown; on completion auto-save through `saveOutput`.
- **Integration buttons** on a result: "Poslať do Blog Writera", "Vytvoriť Brief z refresh plánu", "Exportovať Markdown". (TrustGraph button omitted — feature does not exist; per spec, hidden.) Hand-off via `sessionStorage` consistent with app usage.
- Slovak premium/witty microcopy used sparingly (e.g. "Tento článok ešte žije, ale už podpisuje závet.").

## Decay logic (in `decay-analyze.server.ts`)
- Per page: current/previous clicks, impressions, ctr, position + deltas and delta %, `top_lost_queries`, `decay_type`, `priority_score`.
- Decay types: Traffic Drop / CTR Drop / Ranking Drop / Impression Drop / Hidden Opportunity (impressions high, CTR low, position 4–20).
- Priority: High (prev clicks ≥20, clicks −≥25%, impressions ≥100), Medium (high impressions, weak CTR, position 4–20), else Low. MVP caps query-level work to top 20 decayed URLs.

## Database
- **No schema change required** — reuses `generated_outputs` (RLS already scopes to `auth.uid()`). Only the app-level `type` enum gains `"decay"`. (`generated_outputs.type` is a free `text` column, so the DB accepts it; no migration needed.)

## Connector setup step
- I will prompt you to link the **Google Search Console** connector so `GOOGLE_SEARCH_CONSOLE_API_KEY` exists for live mode. Until then, Demo mode is fully functional, so the feature ships and is testable immediately.

## Verification before claiming done
- Build/typecheck passes (harness runs it).
- `/decay` loads; unauth redirect works; nav shows "Decay Radar" desktop + mobile.
- Demo mode: analyze → table → drawer → stream plan → saved to history under "Decay Radar" filter.
- Existing routes `/`, `/audit`, `/brief`, `/plan`, `/history`, `/raketa`, `/login` unchanged.
- Endpoints reject unauth (401), bad input (400), oversize (413), and rate-limit (429).

## Needs manual testing
- Live GSC after connector link (real properties + real period comparison) — depends on a connected GSC account with verified properties and sufficient data.
