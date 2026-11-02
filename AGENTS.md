# Architecture rules
- Shared visual roles and motion belong in src/styles.css; feature components use semantic tokens so presentation remains consistent.
- Preserve existing storage identifiers and API contracts during branding changes to avoid breaking saved context and integrations.
- Use the installed TanStack Start server-function `.validator()` API; verify dependency support before changing the chain to prevent module-initialization crashes.