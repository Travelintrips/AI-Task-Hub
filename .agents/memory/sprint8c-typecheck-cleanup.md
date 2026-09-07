---
name: Sprint 8C TypeCheck Cleanup
description: Patterns for fixing TS7030, TS2345, TS2769 across Express route handlers
---

## TS7030 (Not all code paths return a value)

Triggered when async arrow function handlers use `return res.status(xxx).json(...)` in
some code paths (try block early returns + happy path) but the catch block just calls
`res.status(500).json(...)` without `return`.

**Fix**: Add `return` before ALL `res.xxx.json(...)` calls including catch blocks, so
TypeScript infers a consistent `Promise<Response>` return type.

**Why**: Without `return` in catch, TypeScript sees mixed return types (Response | void)
and flags TS7030. Governance.ts pattern uses `: Promise<void>` annotation instead, but
that requires changing `return res.json()` → `res.json(); return;`.

## TS2769 (logisticPurchaseRequestsTable)

Valid fields for insert: `requestNumber`, `companyId`, `requestedBy`, `description`,
`estimatedAmount` (NUMBER not string), `status`, `notes`, `rejectedReason`.

NOT valid: `category`, `urgency`, `currency`.

**Why**: These fields were presumed to exist from fleet context but were never added to
the purchasing schema (Sprint 6B).

## TS2345 (req.params in Express 5)

`req.params` fields are typed as `string | string[]`. Always cast with `as string`.

## StatCard ReactNode

When a page-local StatCard component has `value: string | number`, widen to
`value: React.ReactNode` when JSX elements are passed as values.
