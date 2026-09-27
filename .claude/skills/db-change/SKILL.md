---
name: db-change
description: Standard format for any CrackAPack database change, a new migration, table, function, guard trigger or ledger. Use whenever touching packages/db.
---

# CrackAPack database change

1. **New file, never edit an applied one.** Add `packages/db/migrations/NNNN_short_name.sql` with the next number. Start it with a comment block stating the invariants it enforces.
2. **Logic goes in a plpgsql function** named as a verb (`place_order`, `lock_batch`). App code calls functions only.
3. **Money** is `bigint` credits or cents. Time comes from `app_now()`.
4. **Ledgers** are append only: `reject_mutation()` trigger for update and delete, a cache table updated by an after insert trigger, and a named CHECK constraint on the cache. Update the cache before inserting, because CHECK runs on a proposed row before ON CONFLICT.
5. **Guards**: compare flags with `app_flag('app.x')`. Freeze fields with a `(a, b, c) is distinct from (...)` tuple check.
6. **Audit**: anything touching a batch, box, pack, clip or notification calls `log_custody(batch_id, 'event_name', payload, actor)`.
7. **Errors**: `raise exception 'snake_case_code'`.
8. **Tests** go in `packages/db/test/<area>.test.ts` using `freshDb()`, fixtures from `fixtures.ts`, and `atTime()` to pin the clock. Every invariant needs one test proving the happy path and one proving the violation is rejected. Concurrency sensitive code needs a parallel test.
9. Run `pnpm --filter @crackapack/db test` and typecheck before committing.
