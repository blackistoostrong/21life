# Dev 9.3.0 — web journal hardening

Work in progress within DEV26-05. This is not completion of the cross-platform synchronization or architectural work.

The web journal now uses a versioned envelope keyed by account and playgroup. The envelope declares schema version 2 and its account owner; record and server-record IDs/groups must agree. Queued mutations, operation IDs, finalization payloads and undo/redo entries are validated before replay. Duplicate operation IDs, unknown mutation types, malformed operations, mismatched groups and unknown envelope versions are rejected and preserved, rather than silently interpreted as empty queues.

The old group-only v1 key remains readable for the game's creator account. Automatic migration requires matching creator/group and a validated payload; the replacement is written and read back before removing the legacy key. An ambiguous legacy journal stays untouched and produces a persistent recovery notice. Another account's v2 key is neither read nor cleared. A late acknowledgement for game A cannot clear game B's journal.

Writes and removals return explicit results. Quota, denied storage and silent storage failures cannot escape as unhandled exceptions or be described as successful local persistence. The current in-memory game stays available. A warning remains visible on setup, active game and recap as appropriate; the sync badge stops reporting success when local persistence has failed. Optional setup/onboarding preferences cannot prevent the actual game journal from attempting to save.

A new game cannot overwrite a journal containing unacknowledged creation, mutations, finalization or cancellation. Bootstrap preserves pending game A when the server reports B, and clears terminal/history references when adopting a different game after the previous journal is safe. Pending creation is retried after reload. Creation and terminal commands count as pending operations even when the mutation queue is empty. Terminal events from another client preserve locally pending operations for recovery.

Responsibilities:

- `lib/live-game-journal-types.ts`: journal and finalization types, with compatibility re-exports from the old adapter.
- `lib/live-game-journal-contract.ts`: runtime payload validation and pending-operation predicate; no browser storage.
- `lib/live-game-offline.ts`: account/group storage, migration and acknowledgement-scoped removal; no UI.
- `components/live-game/web-journal-warning.tsx`: translated persistent status, no persistence or remote commands.
- The existing web live-game controller still coordinates lifecycle and sync; its decomposition remains DEV26-11 work.

Unit invariants cover account/group isolation, migration ordering, retained legacy data on quota failure, future/corrupt envelopes, operation validation, pending-game replacement refusal, late acknowledgements and unavailable storage. The live browser flow additionally injects real Storage quota failures, checks the warning and durable snapshot, then restores storage/network and verifies that the in-memory action reaches the server exactly once.

Verified commit `b8cd22fa`: 17 dedicated unit tests and full web quality (445 tests, 53 script tests, 107-file coverage ratchet) pass. Journal coverage floors increased from zero; no existing floor was lowered. Next build passes with 54 routes. Real Dev desktop/mobile E2E passes with four players and two clients, including offline/reload, simulated expired session, concurrent mutations, injected quota failure and recovery, lost finalization response, exactly two saved matches for two flows, and verified fixture cleanup. Evidence: `artifacts/dev26/quality-web-journal-candidate.log`, `web-journal-build.log`, `web-journal-e2e.log`. Integration on Dev remains pending with draft PR241.

The next candidate adds `packages/domain/live-game-sync-presentation.ts` as the single web/native state/count/authentication classifier and shared IT/EN instructions. It separates eight states, including authentication required, offline with pending operations and local storage unavailable. PostgREST authentication codes are checked against the [official JWT error reference](https://docs.postgrest.org/en/stable/references/errors.html#group-3-jwt). Permission failures remain distinct. Web badge timers now belong to `WebSyncBadge`; announcements exclude per-tap counts and debounce transient states. The native arena uses the same contract and includes queued creation/terminal/outbox commands; its writer serializes snapshots, reports persistence failure and preserves rejection for callers that require a durable save before archival/replacement. It also handles fire-and-forget writes without treating a failed save as success. Native shadow copies/outbox and recent PR246 fixes remain intact.

Still required for DEV26-05: account-change/in-flight cancellation, same-browser multi-tab queue ownership, the full recovery interaction for retained incompatible journals, native journal/outbox scope hardening and telemetry/retention documentation. Builds/exports and real-browser verification of the newest shared-presentation candidate are tracked in PROJECT_CHECKLIST. No database migration is introduced by this journal change.

Shared-presentation candidate `aa814d21` verified: web476 / Expo369 tests, script53, coverage ratchets109/107, Next54 routes with2.82MiB JavaScript, Android export9.26MiB and iOS export pass. The real Dev four-player/two-client flow passes desktop/mobile with the new authentication-required state, preserved queue after401, quota warning/retry and lost-finalization-response idempotency. Exactly two matches and fixture cleanup verified. Evidence: `artifacts/dev26/shared-sync-{web-quality,expo-quality,web-build,native-export,e2e}.log`. Native exports verify bundling and types; they are not native device interaction tests.

## Existing response-listener warning

`artifacts/dev26/listener-diagnostic.log` captures `NODE_OPTIONS=--trace-warnings` on the pre-journal candidate. Desktop/mobile authenticated responsive checks pass with fixture cleanup. The warning stack attaches listeners in Next's bundled `compression` and `httpxy` response forwarding (`handleResponse`), rather than identifying an application React effect. This locates the observed attachment; it does not prove absence of a framework leak. No listener limits were raised, warnings suppressed or dependency patches applied. The application lifecycle audit remains required.
