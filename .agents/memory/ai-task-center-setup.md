---
name: AI Task Center setup quirks
description: Two fixes required when importing/running this project on Node.js 20 in Replit.
---

## Fix 1: Supabase WebSocket on Node.js 20

Node.js 20 lacks native WebSocket support. Supabase's realtime client crashes at startup unless you pass the `ws` package as the transport.

**How to apply:** In `artifacts/api-server/src/lib/supabase.ts`, install `ws` and pass it:
```ts
import ws from "ws";
createClient(url, key, { realtime: { transport: ws as unknown as typeof WebSocket } })
```

**Why:** `@supabase/realtime-js` requires WebSocket; Node 22+ has it natively but Node 20 does not.

## Fix 2: TanStack Query deduplication in Vite

`@workspace/api-client-react` has `@tanstack/react-query` as a direct `dependency` (not peer). pnpm installs a separate copy under `lib/api-client-react/node_modules`, causing two TanStack Query instances. This breaks the `QueryClientProvider` context (hooks can't find the client) and produces "Invalid hook call" + `.map is not a function` errors.

**How to apply:** Add `@tanstack/react-query` to Vite's `dedupe` array in `artifacts/ai-task-center/vite.config.ts`:
```ts
resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query"] }
```

**Why:** Vite dedupe forces all imports of the package to resolve to a single instance, sharing the React context correctly.

## Artifact registration after import

Imported projects don't auto-register artifacts. Call `verifyAndReplaceArtifactToml` with the existing `artifact.toml` path as both `tempFilePath` and `artifactTomlPath` to force registration. Then use artifact-managed workflows (not manually configured ones).
