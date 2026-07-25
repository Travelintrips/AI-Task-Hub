---
name: WhatsApp Document Attachment (CI/PL)
description: How Commercial Invoice and Packing List are uploaded and sent as WA document attachments via Fonnte.
---

# WhatsApp Document Attachment for CI/PL

## Problem Fixed
- Mini-form file fields (CI/PL) only stored the **filename string** (`file.name`), NOT a URL
- WA notification showed `• commercial_invoice: Commercial Invoice.pdf` as plain text
- Fonnte requires a public URL to send files as WhatsApp attachments

## Solution Architecture

### 1. Supabase Upload from Mini-Form (`mini-form-page.tsx`)
- New endpoint: `POST /api/public/mini-form-upload-url` — returns `{ uploadUrl, publicUrl, path }`
- When user selects a file in a `type: "file"` field:
  1. POST to `/api/public/mini-form-upload-url` with `{ filename, mimeType }`
  2. PUT file content directly to `uploadUrl` (Supabase signed URL)
  3. Store `publicUrl` as field value (not filename)
- UI shows uploading indicator; submit button disabled during upload
- On success: shows ✅ with filename extracted from URL

### 2. Fonnte Document Sending (`fonnte.ts`)
- New function: `sendFonnteDocument(to, documentUrl, filename, fonnteDevice?)`
- Uses Fonnte API params: `target`, `url`, `filename`
- Supports group JID (tries all tokens until one succeeds)
- Handles token resolution same as `sendFonnte`

### 3. Intake Form Notification (`intake-form.ts`)
- CI/PL fields (`commercial_invoice`, `packing_list`) **excluded from text summary** entirely
- After text message sent, check if CI/PL field values are public URLs (start with http)
- If URL: call `sendFonnteDocument` for each receiver separately
- Filename extraction: strips URL path + removes timestamp prefix (e.g., `1753449600000_`)
- If not URL (just filename): skip attachment silently, log warning

## Key Code Locations
- `artifacts/api-server/src/lib/fonnte.ts` — `sendFonnteDocument` function
- `artifacts/api-server/src/routes/public.ts` — `POST /public/mini-form-upload-url`
- `artifacts/ai-task-center/src/pages/mini-form-page.tsx` — `handleFileUpload`, `FileFieldRenderer`
- `artifacts/api-server/src/routes/intake-form.ts` — CI/PL exclusion + attachment loop

## Why Two Requests
Fonnte only supports one file per request. CI and PL are sent as two separate Fonnte calls.
