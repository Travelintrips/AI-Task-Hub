# GPT02 DEV — canonical lifecycle hold and one-shot continuation safety

The historical one-shot Task136 had `category=internal_test`, `autoContinue=false` and exactly one verified final response. The DEV lifecycle button is intentionally disabled until authoritative pre-dispatch Core task, signed operator approval, immutable binding, nonce consumption and lease fencing exist. This change does not create any of those proofs or dispatch a new task.

## Concrete policy defect

The lifecycle hard-stop compared the caller's unnormalized `accountAlias` while the eventual command path resolved a canonical alias from the request or server default. The earlier first-stage lifecycle guard already rejected lowercase and whitespace aliases, so **there was no demonstrated live dispatch bypass**; however, the separate comparisons could drift. The route now calculates `normalizedAccountAlias` once, before either lifecycle gate, and uses the same value for durable command metadata. Variants like `gpt02`, ` GpT02 ` and the explicitly configured default GPT02 all receive the same HTTP409 proof-required response without a Core command.

More importantly, the create and reset paths previously populated `autoContinue=true` for any `category=ai_chat` ChatGPT task, regardless of whether it was a one-shot GPT02 request. The background continuation scanner and manual continuation route already rejected GPT02, but the persisted flag contradicted the approved one-shot contract and could mislead other downstream consumers. All three metadata writers now explicitly keep `autoContinue=false` whenever the canonical account is GPT02. Other GPT accounts keep the previous category/lifecycle behavior. The background and manual GPT02 continuation blocks are preserved unchanged.

## Security and verification

- The exact `lifecycleStart=true` GPT02 handler is still blocked before execution insertion/dispatch and does not accept caller-asserted approval flags. Invalid worker modes stay blocked.
- Source tests evaluate both actual `autoContinue` expressions for all GPT02 one-shot categories and verify unchanged GPT01 and worker behavior. They verify manual and scheduled continuation remain blocked for GPT02.
- The existing isolated PostgreSQL/API runner exercises the actual compiled route with canonical case/whitespace aliases and omitted alias, before and after synthetic PIC assignment. No real credential/command reaches CST DEV/PROD; the test uses isolated networking and synthetic accounts.
- No historical tasks, Core commands, ACKs, approvals, crypto keys, PROD services or live DEV database data are modified by these tests.

**This repairs the one-shot policy but does not authorize managed lifecycle.** Real operator consent, independent issuer/attestor and pre-dispatch provenance remain required for a distinct future authorized managed task.

## Executed evidence (2026-11-09)

- Source policy tests: **8/8 PASS**. Existing historical execution-outcome tests: **19/19 PASS**. Full API typecheck, bundled API build and Pino worker portability: **PASS**.
- Built a throwaway, versioned candidate image from the current held DEV image with only the compiled API bundle overlaid. No active service or real database was connected to that image.
- Real API integration in an internal-only Docker network with disposable PostgreSQL 16 and synthetic auth/PIC: **11 denial scenarios PASS**. Lowercase/mixed case/whitespace GPT02 aliases resolve to the same 409 held-lifecycle result. The omitted alias remains blocked; no unauthorised execution is created for the tested lifecycle or another tenant. Forged status assertions cannot start lifecycle.
- Independent positive one-shot ledger-path check: a synthetic GPT02 task with `category=ai_chat` and approved synthetic PIC produced **exactly one** isolated execution, with persisted `accountAlias=GPT02` and `autoContinue=false`. Remote AI Core was unreachable by design, so this test does NOT claim a new native completion. The query output is asserted to match exact values, not merely printed.
- All disposable API/PostgreSQL test containers and the internal test network were removed on exit. The independent full native Task136 receipt and final ACK are unchanged, and Task135 was never retried.

The simulated isolated operator is not equivalent to real command-bound Super Admin consent. These tests PASS only the one-shot metadata and fail-closed lifecycle guard, **not full managed GPT02 issuance**.

## Executed evidence (2026-11-09)

- Source policy tests: **8/8 PASS**. Existing historical execution-outcome tests: **19/19 PASS**. Full API typecheck, bundled API build and Pino worker portability: **PASS**.
- Built a throwaway, versioned candidate image from the current held DEV image with only the compiled API bundle overlaid. No active service or real database was connected to that image.
- Real API integration in an internal-only Docker network with disposable PostgreSQL 16 and synthetic auth/PIC: **11 denial scenarios PASS**. Lowercase/mixed case/whitespace GPT02 aliases resolve to the same 409 held-lifecycle result. The omitted alias remains blocked; no unauthorised execution is created for the tested lifecycle or another tenant. Forged status assertions cannot start lifecycle.
- Independent positive one-shot ledger-path check: a synthetic GPT02 task with `category=ai_chat` and approved synthetic PIC produced **exactly one** isolated execution, with persisted `accountAlias=GPT02` and `autoContinue=false`. Remote AI Core was unreachable by design, so this test does NOT claim a new native completion. The query output is asserted to match exact values, not merely printed.
- All disposable API/PostgreSQL test containers and the internal test network were removed on exit. The independent full native Task136 receipt and final ACK are unchanged, and Task135 was never retried.

The simulated isolated operator is not equivalent to real command-bound Super Admin consent. These tests PASS only the one-shot metadata and fail-closed lifecycle guard, **not full managed GPT02 issuance**.
