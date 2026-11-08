# Rate-limit first-bucket concurrency verification

## 2026-11-08 — Bounded duplicate-insert race fix

While validating the website password-reset flow, the full backend regression initially failed the existing overlapping device-revocation case (120 tests passed, one failed). A focused repetition of that original case passed; the original boolean assertion did not expose the error code. Its assertion now reports only safe HTTP status/error code/success metadata without weakening success or timestamp/audit requirements.

Direct disposable MongoDB tests reproduced a separate concrete rate-counter failure: bursts fitting entirely within a fresh counter budget could be rejected, including weighted requests whose total cost matched the maximum. The service's conditional upsert could race another insert of the same counter ID; every duplicate-key response previously became RATE_LIMITED, even when capacity remained.

After duplicate-key rejection only, the service now performs one non-upserting increment against the same counter ID and `count <= maximum - cost` predicate. A successful increment accepts that attempt; no matching row still yields 429. The rejected insert did not spend budget, and the retry retains the atomic cost predicate. Existing scope hashes, epoch windows, TTL metadata, configured maxima, weighted costs and error handling for other database failures remain unchanged. This does not retry arbitrary authentication or recovery requests.

Real integration cases cover eight fresh identities with ten concurrent requests fitting each budget, concurrent weighted costs 2/2/1 fitting a maximum of 5, rejection after that weighted capacity is spent, and concurrent rejection of a full bucket. A bounded logical clock isolates these concurrency checks from minute rollover/TTL deletion. Fixtures use only exact generated `sbt_<32 hex digits>` databases, verify initial emptiness and exact identity before cleanup, and close their own connections. No application records are fixtures.

The focused rate/device run passed both suites (28 tests), including the original overlapping-revocation case with its timestamp and audit checks. The initial two failing new concurrency cases are failure evidence, not passing results. The final complete regression passed eight suites/124 tests. Non-fixing lint, non-writing TypeScript inspection, 103 unit tests, Nest build and the official Postman CLI regression (83 requests/322 assertions, zero failures) passed after the fix. HTTP E2E also passed 18 tests during this increment. All disposable suites/hosts closed their owned connections/listeners and guarded their exact database cleanup. See [development progress](Development_progress.md).

Changed files for this fix: `src/modules/auth/auth-rate-limit.service.ts`, `test/auth-rate-limit.integration-spec.ts`, `test/device-enrollment.integration-spec.ts`, and this record. The recovery browser fixture/UI work is committed separately.
