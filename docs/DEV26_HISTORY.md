# Dev26 — bounded arena history

Backend/query foundation, Dev only, candidate9.3.0. This does not certify the existing history UI or complete DEV26-06/11.

## Contract and ownership

- `get_arena_history_page_v2` returns one versioned JSON page, at most100matches, with exact filtered total, group/filter echo, as-of time, revision and continuation cursor. Order is `played_at DESC NULLS LAST,id DESC`. Since/until use `[since,until)`; missing timestamps are included only without period bounds and use the explicit `undated` key.
- The private serializer preserves the existing authorized day RPC's match/participant snapshot and current-label shape, including guests and historical deck fields. It adds a server arena-day key. A late-night match shifts before08:00UTC only when the preceding calendar day contains a match in the full group. The server checks full context, independently of which rows happen to be on the current page.
- `get_arena_match_day_summaries_v2` wraps all day groups in one complete JSON object, avoiding the1,000row table cap. Legacy RPCs remain for installed clients.
- Every page/summary checks current membership or admin authority; anonymous and userless service access is denied. Private helpers and `private.arena_history_revisions` have no API-role execute/read grant. The private table has RLS enabled.
- Revision metadata increments once per affected group/statement for stored match/participant insert/update/delete. A changed revision stops traversal, including result/snapshot corrections; membership is checked again even when the revision is unchanged. The counter is a coherence check, not a security token. Current profile/deck labels may remain live across requests; this is not a database snapshot.
- `packages/domain/arena-history.ts` validates context, counts, nested references, order, null chronology and continuation. Timestamp comparison preserves PostgreSQL microseconds instead of treating distinct sub-millisecond timestamps as UUID ties.
- `packages/data/arena-history-query.ts` owns typed transport and sanitized errors; the clients have compatibility exports.15s per request and a conservative8MiB text bound. `request-deadline.ts` owns transport controller/timer cleanup and propagates parent cancellation. The existing live-game name/error text remains compatible. Metro watches the new data directory; platform builds remain a required gate.

## Evidence

Migration20261117075535 is applied only on Dev and immutable. Registry checksum, actual member/anon/service grants, private-table RLS, six statement triggers, zero SQL fixtures and HTTP denials are verified read-only. The newer independent admin-scope migration20261117082649 was applied first to correct the reproduced legacy caller-RLS leak; fresh CI applies both migrations before running QA. See DEV26_AUTH_SCOPE.md.

`node scripts/run-dev26-analytics-qa.mjs --history --admin-scope` executes applied-schema checks in one rollback-only transaction. It covers2,501exact match IDs through26pages, equal timestamps, null tail, legacy nested-shape parity, registered/guest snapshots, period bounds, cross-group/anon/service denial, actual admin access,1,000+day summaries and conditional late-night grouping. Authenticated batch writes prove counter increments, participant correction invalidation, membership revocation and safe group-deletion cascades. No per-statement RLS resets hide the admin helper defect.

The first implementation scanned/fingerprinted the whole group per page and exceeded the performance allowance. Replaced that scan with private revision metadata and made period bounds indexable, with a separate null-date branch. Last comparable same-session/dataset/period/cards p95: old15.80ms, v217.19ms (+8.8%); serialized payload251,070→253,926bytes. Plans and repeated timings are retained in the ignored SQL QA log. No global planner setting or public-table index change; the private counter uses its primary key.

44web contract/query tests pass, including real SQL serialization and microsecond/timezone cases. Native query/deadline tests pass. Authenticated Dev API plus real4player/two-client live flows pass desktop/mobile4/4; after finalization, v2 history and day counts are exactly2, revision advanced, retries remained idempotent, and fixture cleanup passed. Tokens stay in process memory and trace is off; the fixture runner also redacts the temporary access token from retained text artifacts.

## Remaining integration

Web period history still uses a potentially capped table scan; its recent100rows must be presented as a page with an explicit total/continuation. Native already has a keyset reader, but converts errors to successful empty pages. Replace these paths through feature-owned controllers; preserve current filters, dialogs, exports and snapshot precedence, expose loading/error/restart, cancel old account/group requests, and show partial-page counts honestly. Full day exports must fetch all bounded pages, not only visible rows. A backend capability alone does not complete these tasks.

The full database backup already dumps every schema. Its row-count oracle currently lists public/auth/storage; include private/app_private in the final extended restore verification after schema work, so the new revision metadata and migration registry are explicitly compared too.
