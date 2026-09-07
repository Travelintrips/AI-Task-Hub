---
name: Mini-form response scope
description: Scope rules for the public mini-form POST handler and late response failures.
---

# Mini-form response scope

The public mini-form POST handler can successfully create the task, send notifications, and update the intake session before it builds the final JSON response. Any value used by that final response must therefore be declared in the handler scope, not inside `if (isComplete)` or a notification block.

**Why:** A late `ReferenceError` can return HTTP 500 after the user's data is already persisted, causing the frontend to show “Gagal menyimpan data form” and encouraging duplicate submissions.

**How to apply:** When adding response metadata such as attachment status, declare it alongside `taskId` and `taskNumber`; test both complete and incomplete submissions and assert the final HTTP status.