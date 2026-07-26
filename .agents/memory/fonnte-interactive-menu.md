---
name: Fonnte Interactive Menu
description: How to make customer WhatsApp menu choices tappable through the Fonnte gateway.
---

Fonnte's native button and list-message features are deprecated. The `/send` API polling fields (`choices`, `select`, and `pollname`) create a vote poll, not an action menu. Tappable actions require WhatsApp Cloud API interactive buttons or a Fonnte dashboard Flow/Submission.

**Why:** Fonnte's current documentation says regular, template, and list buttons are no longer maintained, while polling is explicitly a voting feature.

**How to apply:** Prefer Cloud API reply buttons when Meta credentials are configured. If only Fonnte is configured, use a dashboard Flow/Submission and route its `text` callback, or send plain text without pretending it is clickable. Do not rely on numeric replies when those numbers overlap with the greeting menu.