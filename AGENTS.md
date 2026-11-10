# AI Agent Architecture & Workflow Rules

## 1. Architecture & Security Rules

- **Shared Visual Tokens & CSS:** Shared visual roles and motion belong in `src/styles.css`. Feature components must use semantic tokens so presentation remains consistent across dark/light modes.
- **Tailwind CSS v4 & Lightning CSS:** All `@import` rules must remain strictly at the very top of `src/styles.css` before any `@theme` declarations. External fonts (Outfit, Figtree) are loaded via `<link>` in `src/routes/__root.tsx`.
- **API Contracts & Storage:** Preserve existing storage identifiers, Zod schemas, and API contracts during changes to avoid breaking saved context, database records, and integrations.
- **Server Functions:** Use the installed TanStack Start server-function `.validator(...)` API. Never use `.inputValidator(...)`.
- **Router:** Use `@tanstack/react-router` exclusively. Never install or import `react-router-dom`. Do not manually edit `src/routeTree.gen.ts`.
- **Cloudflare Worker Runtime Safe:** Never initialize `new Date()` as a static top-level module constant (it defaults to epoch 1970 on worker boot). Always evaluate dates dynamically inside request handlers.
- **Multi-Tenant GSC Isolation:** Never return global connector properties indiscriminately. Use `listUserVerifiedProperties(userId, email)` and enforce `assertUserPropertyAccess(userId, siteUrl, email)`. Non-admin tenants must never see or analyze properties they do not own.
- **Slovak NLP & Localization:** Never hardcode a single city (e.g. Bratislava) in SEO rules. Support all 79 districts and nationwide businesses via `LOCATIONS`. Use calibrated `textPixelWidth()` to accurately measure Slovak accented characters (`í`, `ĺ`, `ľ`, `ť`, `Á`, etc.) in SERP previews.
- **Edge Rate Limiting & Memory Bounds:** In-memory maps in `src/lib/rate-limit.server.ts` must maintain a strict capacity ceiling (`MAX_BUCKETS = 2000`) and auto-prune expired buckets to protect Cloudflare Worker 128 MB isolate memory.
- **Concurrency & Resilience:** Heavy API jobs (e.g. GSC Decay Radar) must use chunked concurrency (e.g. `concurrency: 4`) rather than sequential loops to prevent worker CPU/execution timeouts.

## 2. Git Workflow (Local ↔ GitHub ↔ Lovable)

To prevent split branches, diverging heads, and merge conflicts with Lovable Cloud:

1. **Pull before starting any work:**
   ```bash
   git pull --rebase origin main
   ```
2. **Verify tests and type integrity:**
   ```bash
   bunx vitest run
   bun run tsc --noEmit
   ```
3. **Commit with GPG signing directly to `main`:**
   ```bash
   git add .
   git commit -m "feat/fix: concise description of change"
   git push origin main
   ```
   Lovable listens on the `main` branch of `youh4ck3dme/metaseopro` and automatically synchronizes pushed commits.

## 3. Environment & Security Rules

- `.env` contains strictly public frontend & SSR keys (`VITE_SUPABASE_*`, `SUPABASE_*`).
- Never commit secrets (`LOVABLE_API_KEY`, `SEMRUSH_API_KEY`, `GOOGLE_SEARCH_CONSOLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`) to Git.
- Local overrides and secret testing must use `.env.local` (ignored by Git).
