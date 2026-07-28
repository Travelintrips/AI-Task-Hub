---
name: Fonnte document send — message parameter required
description: sendFonnteDocument gagal dengan "message cannot empty" karena Fonnte /send wajib mengisi field message meski ada url+filename.
---

## Rule

`sendDocWithToken` di `fonnte.ts` harus selalu menyertakan field `message` dalam `URLSearchParams` saat mengirim file via URL. Tanpa `message`, Fonnte mengembalikan `{"reason":"message cannot empty","status":false}`.

**Why:** Fonnte API `/send` memperlakukan `message` sebagai field wajib bahkan untuk file attachment — dokumen dikirim sebagai file dengan caption, bukan sebagai pengganti teks.

**How to apply:** Isi `message` dengan `filename` sebagai caption:

```typescript
const params = new URLSearchParams({
  target:   phone,
  url:      documentUrl,
  filename: filename,
  message:  filename,   // ← WAJIB, tanpa ini Fonnte tolak
});
```

**Bukti:** Test langsung ke Fonnte API tanpa `message` → `status:false, reason:"message cannot empty"`. Dengan `message` → `status:true, id:[169963615]`.
