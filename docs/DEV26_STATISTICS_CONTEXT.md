# DEV26-07 — Statistical context and consolidated verification

Group player/deck reports explain the win-rate denominator in Italian and English: wins divided by games with a winner, excluding draws. Without decisive games the presentation remains neutral. The existing five-game threshold controls default deck visibility; it does not establish statistical reliability. Reports explain that duel and multiplayer results have different table-size contexts. Complete history cards show the actual participant count on both platforms.

No calculation, ordering, period/bracket filter, visibility threshold, query or database contract changed. Existing record counts and filter/revision invalidation remain authoritative. Neutral presentation on personal, archived and public consumers was integrated separately through PR278–281.

Runtime `9280a59438dbda652495bff14105b9924df1ac25`, version 9.3.0/90300, Dev:

- Web quality: 1,065 passed, three unchanged skips; 80 script tests; coverage ratchet163 files. Native quality: 870 passed, coverage ratchet151 files. Actual SQL serializer payloads enabled the optional contract checks; previous floors remain unchanged.
- Clean web build56 routes, JavaScript3.57/18 MiB; Android/iOS Dev exports on the same runtime SHA, JavaScript9.48/12 MiB. Expo Doctor21/21 passed with a process-only DNS fallback after the first network failure; iOS readiness passed.
- Complete authenticated browser matrix: 88 passed desktop/mobile, exactly two saved matches for two live flows, finalization idempotency and fixture cleanup verified. Includes updated help assertions, retry, neutral values, existing sample toggle, preset/rematch/recap and critical write/sync flows. Initial new help assertion ran before report recovery; moving it after Retry fixed the test without product changes.
- Separate real-backend admin checks: two passed, including filters, CSV completeness, accessibility, anonymous/member denial and verified removal of synthetic accounts/allowlist entries. The compiled runtime was reused after a runtime-path identity check.
- Fresh rollback-only Dev SQL QA passed personal/global/profile/catalog/history/arena aggregates, roles and revisions. Sixty-three client contract tests accepted the fresh serializers. Arena warm p95 was476.30ms legacy/113.22ms v2 on that dataset; profile10.93/11.99ms and history17.55/17.76ms. These measurements are not latency guarantees.
- Production dependency audit: web5/native8 moderate, zero high/critical. Complete audit: web11/native8 moderate, zero high/critical. No exception added or threshold relaxed.
- Final mobile player/deck report images were inspected for text wrapping and clipping. Responsive layout and wizard visual regressions passed in the browser matrix. Native and browser coverage remain distinct.

Only tests/documentation changed after the runtime build. PR284 and the project checklist own integration status. No migration, dependency addition, production change, release tag or new APK publication occurred.

## Remaining delivery gates

This closes the statistical-context implementation and its browser/shared-contract verification; it is not completion of DEV26-04/12. The existing Android workflow is still manual and uses staging configuration. Required work remains: a PR Android core against a disposable CI backend, three consecutive successful runs on one candidate, and explicit process-restart/rotation/keyboard/damage evidence.

Local Android verification started on Pixel_9 using Expo Go. The cached57.0.2 client crashed in Hermes/Worklets; the official57.0.9 APK was downloaded through the SDK57 link on expo.dev/go and verified against its GitHub SHA-256. The updated client loads the candidate and authentication succeeds. The old Maestro flow then exposed ambiguous numeric selectors and scrolling assumptions; a complete native flow is not yet certified. Expo Go is not a standalone Dev APK or push-notification certification.
