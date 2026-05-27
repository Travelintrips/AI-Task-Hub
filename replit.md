# AI Task Center

An operations platform that receives WhatsApp messages, uses AI (OpenAI) to detect customer intent, creates tasks, audits uploaded documents, assigns work to team members, and sends WhatsApp notifications.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/ai-task-center run dev` — run the React frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + Wouter + TanStack Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (Replit managed)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Integrations: Supabase Storage, OpenAI GPT-4o-mini, WhatsApp Business API

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (tasks, team, messages, documents, activity)
- `artifacts/api-server/src/routes/` — Express route handlers (tasks, team, messages, documents, dashboard)
- `artifacts/api-server/src/lib/` — service libs: openai.ts, whatsapp.ts, supabase.ts, logger.ts
- `artifacts/ai-task-center/src/` — React frontend (pages: Dashboard, Tasks, Messages, Documents, Team)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas for server validation (do not edit)

## Architecture decisions

- Contract-first API: OpenAPI spec gates codegen which gates the frontend — never write types by hand
- WhatsApp webhook at `POST /api/webhook/whatsapp` auto-creates tasks from messages using OpenAI intent detection
- Supabase Storage used for document uploads via presigned URLs; OpenAI audits documents on demand
- All activity (task events, messages, audits) recorded in the `activity` table for the dashboard feed
- Drizzle ORM with Replit managed Postgres; Supabase used only for file storage (not as primary DB)

## Product

- **Dashboard** — Mission Control with live stats (tasks, messages, documents, team) and activity feed
- **Tasks** — Full CRUD with status/priority filtering, team assignment, and linked message/document context
- **Messages** — WhatsApp inbox with AI intent badges; trigger re-processing or send notifications
- **Documents** — Upload via Supabase Storage, trigger AI audit (GPT-4o-mini), view score and issues
- **Team** — Manage team members with roles and contact info

## Required environment secrets

- `DATABASE_URL` — Replit managed Postgres (auto-set)
- `OPENAI_API_KEY` — OpenAI API key for intent detection and document auditing
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anonymous/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (for storage operations)
- `WHATSAPP_TOKEN` — WhatsApp Business API access token
- `WHATSAPP_PHONE_NUMBER_ID` — WhatsApp phone number ID
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — Token to verify WhatsApp webhook requests

## WhatsApp Webhook Setup

Point your Meta Developer Console webhook URL to:
`https://<your-domain>/api/webhook/whatsapp`

Verify token: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN` secret.

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing the OpenAPI spec
- DB schema changes: edit `lib/db/src/schema/`, then run `pnpm --filter @workspace/db run push`
- Supabase bucket `ai-task-center-documents` is auto-created on first upload URL request
- WhatsApp webhook only fires for `whatsapp_business_account` object type events

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
