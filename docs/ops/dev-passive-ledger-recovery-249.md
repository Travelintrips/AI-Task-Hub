# Issue 249 — scoped passive ledger recovery candidate (CST-DEV only)

Problem: canonical Hub runtime on loopback 18181 is healthy; public legacy bridge prefix points at unused 18296. The Core reconciler remains enabled. A blanket prefix cutover would also admit old handshake and protected wake records, and expose unrelated bridge operations.

This candidate adds two opt-in receiver aliases that reuse existing authenticated registration and source-event handlers. Both are closed unless `AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID` pins one exact UUID and host, DEV Supabase project, database locator and migration interlocks match. The scope is only the existing model-free ping audit (canonical Core source, exactly one acknowledged terminal response, exact DELL worker and result, no business/GPT02 link, no conflicting registry row). It is not a new general sync path, worker or credential. It preserves original routes and source-owned ACK behavior; no shared schema, grants, signing, retry or dispatch change.

Release sequence:
1. Complete exact-SHA CI and synthetic SQL/HTTP fixtures before any DEV deploy. Keep the opt-in unset by default. Do not change PROD.
2. Confirm actual runtime SHA and protected-route baseline; explicitly scope the DEV configuration to the already-existing audit command. The source record must pass the eligibility query; do not insert source rows or manufacture ACKs.
3. Review an exact-match Nginx registration location for `/api/bridge/jobs` using the existing POST-only/auth-header restrictions, forwarding to `/api/bridge/dev-passive-recovery/jobs` at the canonical Hub runtime. Do not change the general `/api/bridge/` prefix. Verify rejection of unauthenticated requests and unrelated command IDs.
4. After the approved audit's registry UUID has been obtained and checked, a second exact-match location may forward only `/api/bridge/jobs/<that UUID>/source-event` to its scoped alias. Do not proxy general claim, result, renewal, session, failure, ACK, or GPT02 paths. Keep a prechange backup and rollback on any protected-route/auth mismatch.
5. Let the existing producer mirror only the pinned record using the same canonical external/idempotency key; prove one registry row, one source result event and one receiver-owned source ACK. No new worker job. The registry ACK is not OpenAI model, browser or ChatGPT final delivery proof. Do not mark public.ai_execution_jobs complete from this result.
6. Close the temporary scoped routing and unset the pin after proof; any wider sync restoration requires an explicit backlog scope decision (including the four handshake/four protected wake records).

This is a source-only candidate. No runtime configuration, Nginx location, existing command or ledger record is changed by the PR itself.
