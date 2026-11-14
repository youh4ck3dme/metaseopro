# SEO4WEB — Agent Instructions (Local ↔ GitHub ↔ Lovable)

Scope: entire repository `youh4ck3dme/metaseopro`. Follow more specific nested AGENTS.md files if present. Treat source code and current tests as authoritative when documentation disagrees.

## Architecture invariants
- TanStack Start v1, React 19, Vite 8, TanStack Router, Tailwind CSS v4, Bun, Cloudflare Workers and Lovable Cloud/Supabase. Verify installed versions against package.json and bun.lock before changing dependencies.
- Use `@tanstack/react-router` only; never introduce `react-router-dom`. Do not hand-edit generated `src/routeTree.gen.ts`.
- Use the installed TanStack Start server-function `.validator(...)` API, not `.inputValidator(...)`.
- `vite.config.ts` uses `@lovable.dev/vite-tanstack-config`, which already registers the framework, React, Tailwind, Cloudflare and related plugins. Do not duplicate them.
- Preserve Zod schemas, API contracts, storage keys, route names, migrations and public behavior unless the task explicitly requires a compatible change.
- Do not manually edit generated files under `src/integrations/supabase/`. Apply schema changes through reviewed migrations; never run migrations against production without explicit approval.
- Keep CSS `@import` directives at the beginning of `src/styles.css`, before `@theme`; use semantic design tokens for light/dark themes. Outfit/Figtree font links live in `src/routes/__root.tsx`. Preserve AppHeader navigation groups.
- Compute request-specific timestamps inside handlers; do not cache current time in module-level constants. For GSC period comparisons, derive both windows from one request-local reference time and respect the data lag.
- Preserve Slovak/Czech localization, district-aware SEO logic, `LOCATIONS`, and the existing calibrated `textPixelWidth()` behavior for diacritics.

## Security invariants
- Never commit credentials, tokens, private keys, admin identity lists, customer data, or production exports. Only verified public/publishable values may be tracked in `.env`; use ignored `.env.local` for local secrets and deployment secret stores for production. A `VITE_` prefix means client-exposed, never secret.
- Never embed PATs in Git remote URLs or print credentials in logs. Use `gh auth login`, SSH, or a credential manager; check that `git remote -v` contains no tokens.
- Require authenticated user identity and per-tenant authorization on every GSC property listing and analysis. Use `listUserVerifiedProperties(userId, email)` and `assertUserPropertyAccess(userId, siteUrl, email)`; never trust user-supplied site ownership or expose master connector properties. **Known remediation:** `src/lib/gsc.server.ts` currently includes hardcoded admin email allowlist entries. Remove those in a separate reviewed code change and rely on centrally managed authorization, with negative cross-tenant tests.
- Validate external URLs before server-side fetches with the existing `isSafePublicUrl()` or equivalent vetted guard; reject loopback, private, link-local, metadata endpoints, DNS rebinding and unsafe redirects. Do not claim this protection covers a call site without inspecting it.
- Enforce Supabase RLS and server-side authorization. Keep service-role keys server-only. Validate Stripe webhook signatures and ensure billing writes are idempotent.
- Preserve bounded memory for in-process rate limiting (`MAX_BUCKETS = 2000`) and bounded concurrency for expensive GSC calls; remember in-memory limits are not a global distributed rate limit.
- Do not log raw secrets, access tokens, personal data, or full third-party error bodies that may contain sensitive information.

## Safe Git workflow
1. Before edits, inspect `git status --short --branch`, `git remote -v`, `git branch --show-current`, and `git fetch origin`. Confirm expected repository and upstream. Never discard or overwrite unrelated local changes.
2. Prefer a short-lived task branch based on current `origin/main`; use a pull request with review and CI for changes. Do not force-push, auto-resolve conflicts, or rebase a dirty tree. If Lovable requires direct `main` synchronization, use it only when explicitly authorized for that operation and after all gates pass.
3. Make minimal, scoped changes. Stage explicit paths (`git add -- <paths>`), not indiscriminate `git add .`. Review `git diff --check`, staged diff, and secret exposure before committing.
4. Run applicable checks from the actual repository, using the locked dependency graph:
   ```bash
   bun install --frozen-lockfile
   bunx vitest run
   bunx tsc --noEmit
   bun run lint
   bun run build
   ```
   If a check is unavailable, blocked, or fails, report it accurately; do not label the change green or push to production. For documentation-only edits, perform Markdown/static checks and still report full application tests as not run unless actually executed.
5. Commit with a descriptive message after successful applicable gates. Push only the authorized branch. Verify remote commit, CI checks, Lovable sync and separately the published deployment; GitHub push alone does not prove production deployment. Never claim a GPG-signed commit without verifying the signature.
6. On conflict, stop and inspect both sides; preserve functional changes deliberately and rerun checks. Never assume a blind `git pull --rebase` is safe.

## Definition of done
Report changed paths, tests actually executed and results, security implications, commit/PR URL, remaining blockers, and whether Lovable sync and production deploy were independently verified. Never report unexecuted tests as passing.
