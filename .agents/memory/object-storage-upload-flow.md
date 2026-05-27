---
name: Object Storage upload flow
description: How file uploads work — presigned URL flow, route structure, and key decisions.
---

## The rule
File uploads go through a 3-step flow. The file never touches the Express server.

1. `POST /api/storage/uploads/request-url` — returns a GCS presigned PUT URL and an `objectPath`
2. Client PUTs the raw file directly to the GCS URL (CORS allowed by Replit Object Storage)
3. `POST /api/ai-tasks/:id/attachments` — records {fileName, objectPath, mimeType, fileSize} in DB

**Why:** Replit Object Storage returns presigned GCS URLs. Streaming uploads through Express would be wasteful and add latency. The presigned URL approach is more scalable.

**How to apply:** Any new upload feature should follow this 3-step pattern. Never pipe file bytes through Express for uploads.

## Key types
- `RequestUploadUrlBody` / `RequestUploadUrlResponse` are defined in `lib/api-zod/src/storage.ts` and re-exported from `lib/api-zod/src/index.ts`.
- `task_attachments` table has: `objectPath`, `mimeType`, `fileSize`, `ocrStatus` (pending/processing/completed/failed), `uploadedBy`.
- `fileUrl` stored as `/api/storage/objects{objectPath}` — the Express serve route.

## Serving files
- Public: `GET /storage/public-objects/*` — no auth
- Private: `GET /storage/objects/*` — can add auth middleware
