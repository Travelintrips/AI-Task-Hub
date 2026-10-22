# ChatGPT `#` → AI Task registration

This is a security-focused **handler module**, not a live ChatGPT/browser integration.
Wire it into the AI Task authenticated message API after the backend has verified:

1. The logged-in user and tenant; never accept client-supplied claims as authority.
2. The source ChatGPT conversation ID via an official integration or signed relay binding.
3. A handshake attestation matching the same source conversation, user and tenant.
4. An atomic registry `findOrCreate` with a DB uniqueness constraint on
   `(provider, source_conversation_id, subject)`; return registration/conversation IDs.
5. Server-side authorization, structured audit records, appropriate rate limits,
   and scoped access to any synchronized conversation content.

On an exact `#` message, call `registerHashCommand` and return its result to the
originating authenticated user only. Existing registrations return the same canonical
conversation ID, never a duplicate. A success response is valid only after persistent
registry ACK. The canonical AI Task conversation ID is distinct from the source
ChatGPT conversation ID.

To complete deployment: connect a real backend route, implement the verified
relay handshake and transactionally persisted registry, deploy DEV, test with two
separate customer accounts, and verify an ACK and subsequent message continuation.
No conversation history is automatically accessible from ChatGPT web.

Run unit tests with `node --test integrations/chatgpt-hash-registration/register.test.mjs`.
