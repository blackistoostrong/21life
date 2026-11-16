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

Still required for DEV26-05: a shared web/native presentation model, explicit authentication-required state, account-change/in-flight cancellation, same-browser multi-tab queue ownership, the full recovery interaction for retained incompatible journals, and telemetry/retention documentation. Native shadow copies/outbox and recent PR246 fixes remain intact. No database migration is introduced by this journal change.

## Existing response-listener warning

`artifacts/dev26/listener-diagnostic.log` captures `NODE_OPTIONS=--trace-warnings` on the pre-journal candidate. Desktop/mobile authenticated responsive checks pass with fixture cleanup. The warning stack attaches listeners in Next's bundled `compression` and `httpxy` response forwarding (`handleResponse`), rather than identifying an application React effect. This locates the observed attachment; it does not prove absence of a framework leak. No listener limits were raised, warnings suppressed or dependency patches applied. The application lifecycle audit remains required.
