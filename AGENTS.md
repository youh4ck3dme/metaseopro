# AI Agent Architecture & Workflow Rules

## 1. Architecture Rules
- **Shared Visual Tokens & CSS:** Shared visual roles and motion belong in `src/styles.css`. Feature components must use semantic tokens so presentation remains consistent.
- **Tailwind CSS v4 & Lightning CSS:** All `@import` rules must remain strictly at the very top of `src/styles.css` before any `@theme` declarations. External fonts (Outfit, Figtree) are loaded via `<link>` in `src/routes/__root.tsx`.
- **API Contracts & Storage:** Preserve existing storage identifiers, Zod schemas, and API contracts during changes to avoid breaking saved context, database records, and integrations.
- **Server Functions:** Use the installed TanStack Start server-function `.validator(...)` API. Never use `.inputValidator(...)`.
- **Router:** Use `@tanstack/react-router` exclusively. Never install or import `react-router-dom`.
- **Cloudflare Worker Runtime Rule:** Never initialize `new Date()` as a static top-level module constant (it defaults to epoch 1970 on worker boot). Always call dates dynamically inside request handlers.
- **GSC Comparisons:** Compute both inclusive 90-day windows from one request-time clock and merge previous/current URL and query keys so total traffic losses remain visible; zero positions represent missing measurements, not ranking gains.

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
- `.env` contains strictly public frontend keys (`VITE_SUPABASE_*`).
- Never commit secrets (`LOVABLE_API_KEY`, `SEMRUSH_API_KEY`, `GOOGLE_SEARCH_CONSOLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) to Git.
- Local overrides and secret testing must use `.env.local` (ignored by Git).
