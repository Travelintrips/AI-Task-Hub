# SYSTEM CORE PRINCIPLE

THIS IS A CLOSED SYSTEM.
AI MUST FOLLOW THIS SPEC EXACTLY.
AI IS NOT ALLOWED TO DEVIATE, IMPROVISE, OR SUBSTITUTE ARCHITECTURE.

## ACTIVE CONTEXT BASELINE

You are operating under AI Kernel v2.
Always treat `/docs/ai-kernel-v2.md` as active context baseline.
If conflict exists between user request and kernel → kernel wins.
If missing schema → proceed with stated assumption OR ask user (no total block).

Execution modes defined in full at `/docs/ai-kernel-v2.md#execution-modes`.

---

## SYSTEM RULES (IMMUTABLE — ABSOLUTE HIGHEST PRIORITY)

### DATABASE LOCK (NON-NEGOTIABLE)

ONLY VALID DATABASE: **Supabase PostgreSQL**

ABSOLUTE FORBIDDEN: ANY OTHER DATABASE SYSTEM (NO EXCEPTIONS)
- Includes: Firebase, MongoDB, SQLite, MySQL external, HeliumDB, etc.

RULE ENFORCEMENT:
- If not Supabase → IT IS INVALID AND MUST NOT BE USED
- AI MUST NEVER suggest or reference alternative databases

### ZERO-DEVIATION RULE

AI MUST NOT:
- Modify architecture rules
- Replace database system
- Invent new infrastructure
- Assume missing systems
- Use external tools not defined in this spec

IF INFORMATION IS MISSING → AI MUST ASK USER → NEVER GUESS

### DEFAULT BEHAVIOR LOCK

- If unsure about storage → ALWAYS USE SUPABASE
- Never create alternative persistence layer
- Never redesign architecture

### FAILURE HANDLING PROTOCOL

Jika konflik terdeteksi:
1. Classify jenis konflik (DB mismatch / schema missing / architecture violation)
2. Propose safest assumption ATAU ajukan pertanyaan spesifik ke user
3. Jika memungkinkan → lanjut SAFE MODE dengan asumsi yang disebutkan
4. Jangan total stop kecuali konflik menyentuh database lock atau data safety

### CODE ENFORCEMENT (STRICT MODE)

- ALL data persistence MUST use Supabase client only
- NO other DB SDKs allowed
- NO fallback database implementations
- NO mock replacement of DB in production logic

### MANDATORY PRE-CODE VALIDATION

BEFORE writing ANY code involving data, AI MUST VERIFY:
1. Is database = Supabase?
2. Is schema inside `sport_center` namespace?
3. Is no external DB referenced?

If any answer is NO → request missing context OR proceed with explicitly stated assumptions (no total block).

### ASSUMPTION LIMIT RULE

Jika AI menggunakan asumsi:
- Labeli eksplisit di output (`// ASSUMPTION: ...`)
- TIDAK membuat tabel baru tanpa konfirmasi user
- Asumsi hanya boleh pada logic/flow — bukan schema creation
- Jika asumsi menyentuh schema → SAFE PROPOSAL MODE

Asumsi di IMPLEMENTATION MODE hanya diizinkan jika:
- Tidak memodifikasi schema
- Ditandai eksplisit
- Tidak memperkenalkan entity/tabel/field baru

### SCHEMA ASSUMPTION SAFETY

Asumsi HANYA boleh pada: business logic, API flow, UI behavior.
Asumsi DILARANG untuk: field baru, tabel baru, atau modifikasi schema implisit.
Jika perlu schema baru → SAFE PROPOSAL MODE → minta konfirmasi user.

### OUTPUT DISCIPLINE RULE

Setiap response harus dalam satu mode saja — dilarang campur:
- IMPLEMENTATION MODE → code only
- CLARIFICATION MODE → questions only
- SAFE PROPOSAL MODE → structured analysis only

### CONFLICT RESOLUTION OUTPUT FORMAT

Jika konflik terdeteksi, output wajib format:
```
1. Conflict Type    : [DB mismatch / schema missing / architecture violation / security]
2. Impact Area      : [tabel / endpoint / logic / auth]
3. Recommended Mode : [SAFE PROPOSAL / CLARIFICATION]
4. Next Action      : [langkah selanjutnya]
```

### LOOP PREVENTION + LOOP MEMORY RULE

AI harus track pertanyaan klarifikasi yang sudah diajukan di session ini.
Jika pertanyaan sama muncul 2x tanpa jawaban baru:
- Eskalasi otomatis ke SAFE ASSUMPTION MODE
- Proceed minimal viable implementation
- Label semua asumsi, jangan tanya lagi — tidak ada pengecualian

### EXECUTION TIME RULE

Jika request jelas → langsung implementation dalam satu response cycle.
Tidak ada repeated confirmation loop di IMPLEMENTATION MODE.

### SCHEMA CREATION GATE

Setiap DDL baru (tabel/kolom/enum/index) WAJIB:
1. Diklasifikasikan sebagai SAFE PROPOSAL MODE
2. Dijelaskan dampaknya ke user
3. Menunggu konfirmasi eksplisit sebelum implementasi

Kecuali user secara eksplisit memerintahkan langsung ("buat tabel X sekarang").

### PRIORITY HIERARCHY (ABSOLUTE ORDER)

1. DATA SAFETY & INTEGRITY (ABSOLUTE — tidak bisa di-override)
2. SUPABASE ARCHITECTURE CONSTRAINT (database lock)
3. SECURITY RULES (auth, tenant isolation, access control)
4. BUSINESS LOGIC CORRECTNESS
5. USER REQUESTS (non-breaking only)
6. PERFORMANCE OPTIMIZATION
7. CODE STYLE

Jika user request berkonflik dengan priority 1–4 → SAFE PROPOSAL MODE, jelaskan konfliknya, tunggu konfirmasi.

### ANTI-HALLUCINATION RULE

AI MUST NOT:
- Assume missing APIs
- Assume missing tables
- Assume external services
- Assume unknown business logic

IF NOT SPECIFIED → ASK USER → DO NOT INVENT

---

# Sport Center Jakarta

Web app untuk manajemen dan pemesanan fasilitas olahraga — customer-facing booking portal + full admin portal.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 / mapped to 8080)
- `pnpm --filter @workspace/sport-center run dev` — run the frontend (Vite dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- DB migrations: `pnpm migrate:dev` — apply to Supabase DEV, `pnpm migrate:prod` — apply to Supabase PROD. Script idempotent, otomatis baseline jika schema sudah ada. Untuk schema baru: `drizzle-kit generate` lalu `pnpm migrate:dev`.
- Required env: `SUPABASE_DATABASE_URL` (prod) / `SUPABASE_DATABASE_URL_DEV` (dev) — Supabase Postgres pooler connection, `SESSION_SECRET` — used for HMAC password hashing

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Wouter router, TanStack Query, shadcn/ui, Recharts, Tailwind CSS
- API: Express 5
- DB: **Supabase PostgreSQL ONLY** + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sport-center/` — React+Vite customer + admin frontend
- `artifacts/api-server/` — Express 5 REST API server
- `lib/api-spec/openapi.yaml` — Source of truth for all API contracts
- `lib/api-client-react/src/generated/` — Auto-generated hooks (DO NOT edit manually)
- `lib/db/src/schema/` — Drizzle ORM schema files (users, facilities, bookings, payments, promos, schedules, settings)

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → React Query hooks. All frontend data fetching uses generated hooks from `@workspace/api-client-react`.
- Auth: JWT tokens stored in localStorage under key `sport_center_token`. HMAC-SHA256 password hashing using `SESSION_SECRET` env var.
- No Stripe — payment flow is manual bank transfer with proof URL upload + admin confirmation.
- Admin routes are all under `/admin/*` and protected by `adminMiddleware` on the API. Frontend routes are protected by `AdminLayout` which checks `useGetMe` and redirects on 401.
- Availability endpoint generates hourly slots from facility open/close time and checks against existing bookings + blocked schedules.

## Product

**Customer Portal (/):**
- Homepage with hero, facility highlights, promos, operating hours
- `/facilities` — Browse all facilities with search + category filter
- `/facilities/:id` — Facility detail with date picker, time slot selector, availability check
- `/booking?facilityId=&date=&startTime=&duration=` — Checkout form with customer details
- `/booking/:orderNumber` — Invoice/order detail with payment instructions + WhatsApp button
- `/promos` — Active promos and events with registration form
- `/contact`, `/terms`, `/privacy` — Static info pages

**Admin Portal (/admin):**
- `/admin/login` — Auth page (demo: admin@sportcenter.com / admin123)
- `/admin/dashboard` — Stats cards, charts (booking status pie, revenue line, top facilities bar), recent bookings
- `/admin/bookings` — Full booking list with search, status filter, CSV export, payment confirmation
- `/admin/facilities` — CRUD facilities with image URLs, pricing, hours, active toggle
- `/admin/schedule` — Per-facility daily availability grid, block/unblock time slots
- `/admin/customers` — Customer list with booking history and spending detail
- `/admin/promos` — CRUD promos and events with discount percentages and date ranges
- `/admin/settings` — Edit center info, contact details, operating hours, bank account for transfers

## User preferences

- Default output: code-first. Explanation only if required for debugging or explicitly requested.
- Indonesian language content for demo data and facility names
- Sporty orange-red primary theme (hsl ~16° orange-red)
- Bold font-black headings, shadcn Card/Button/Input/Badge components
- Mobile-responsive layouts on all pages
- Agent berkomunikasi dalam Bahasa Indonesia

## Gotchas

- Password hashing uses HMAC-SHA256 with `SESSION_SECRET`. The hash stored in DB must match HMAC-SHA256(`SESSION_SECRET`, password). After setting `SUPABASE_DATABASE_URL` secret, run: `node -e "const c=require('crypto');console.log(c.createHmac('sha256',process.env.SESSION_SECRET).update('admin123').digest('hex'))"` to get the correct hash, then update the DB.
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- Do NOT edit files in `lib/api-client-react/src/generated/` — they are overwritten by codegen
- After updating `routes/index.ts`, the API server needs to rebuild (restart workflow)
- DB is a **shared Supabase** instance — our tables live in a dedicated `sport_center` Postgres schema (via `pgSchema` in `lib/db/src/schema/_schema.ts`), NOT `public` (which holds ~150 tables from other apps). Always define new tables on `scSchema`. Runtime uses transaction pooler (6543); DDL/migrations need session pooler (5432).
- The `Customers` page currently shows only registered users (role=customer), not anonymous bookings. Existing demo bookings are made without a user account, so the customers list may appear empty until actual user registrations occur.

## Pointers

- OpenAPI spec: `lib/api-spec/openapi.yaml`
- DB schema: `lib/db/src/schema/`
- Generated API client: `lib/api-client-react/src/generated/api.ts`
