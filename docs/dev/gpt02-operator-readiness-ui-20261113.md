# GPT02 operator approval readiness (read-only UI)

DEV-only. Displays Super Admin task PIC, audit and lineage readbacks alongside missing operator-signed approval and independently issued lease gates. The latter two are always UNVERIFIED in this UI because no trusted HTTP approval issuer has been mounted.

This feature does not sign approvals, provide an enabled dispatch button, provision credentials, grant an issuer role, create a Core task, consume a nonce, or dispatch to DELL. It does not alter the existing worker route or RLS.

Source-controlled guarantees:
- Pure helper always returns releaseDecision=NO_GO, signingPermitted=false, authorizationGranted=false, dispatchPermitted=false.
- Detail page only shows a Super Admin read-only panel with a disabled approval control.
- Four focused tests verify Task149, forged-green, missing-readback and UI-disabled cases.

Before real operator approval: authenticate the human operator independently; bind task/command/attempt; verify four Ed25519 signer identities against trusted manifest; record fresh per-command signed approval and issuer-controlled nonce/lease; verify attestation/final ACK. Historical Task135/136 evidence does not substitute.
