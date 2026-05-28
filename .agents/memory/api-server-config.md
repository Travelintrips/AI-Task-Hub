---
name: api-server config module
description: Non-sensitive env vars are hardcoded in code with env-var override, not Replit env vars.
---

Replit "env vars" (non-secret) periodically disappear across repl restarts and artifact reconfigurations — only "secrets" persist reliably. So any value that is non-sensitive (URLs, bucket ids, proxy endpoints, dummy keys) must live in `artifacts/api-server/src/config.ts`, with `process.env.X || "<hardcoded>"` so a real secret can still override.

**Why:** The user lost their setup multiple times because Supabase URL, AI proxy URL, and object-storage paths kept vanishing from the env vars panel between sessions. Code-level defaults eliminate that whole class of incident.

**How to apply:** When adding a new integration, decide: is the value a secret? → Replit secret. Otherwise → add it to `config.ts` and reference `config.*` from libs. Never read `process.env.X` directly in lib code for non-sensitive values.
