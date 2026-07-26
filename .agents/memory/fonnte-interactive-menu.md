---
name: Fonnte Interactive Menu
description: How to make customer WhatsApp menu choices tappable through the Fonnte gateway.
---

Fonnte's native button and list-message features are deprecated. For tappable customer choices, use the `/send` API polling fields (`choices`, `select`, and `pollname`) and handle the selected label in the webhook.

**Why:** Fonnte's current documentation says regular, template, and list buttons are no longer maintained, while polling remains a supported send parameter.

**How to apply:** Keep polling choices as stable human-readable labels. Do not rely on numeric replies when those numbers overlap with the greeting menu; route only the labels while the relevant form session is active.