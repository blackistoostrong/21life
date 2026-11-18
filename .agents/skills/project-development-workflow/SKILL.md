---
name: project-development-workflow
description: Apply the PM-led, specification-driven workflow for 21Life. Use for every development, maintenance, audit, release, deployment, documentation, or repository task in this project so branch roles, persistent task tracking, terse communication, and the current code map remain consistent.
---

# Project Development Workflow

## Start every chat

1. Read `.agents/PROJECT_CHECKLIST.md` before taking task action.
2. Treat the user as the PM and specification owner; act as the developer responsible for implementation and verification.
3. Convert the PM's request into acceptance criteria and checklist items. Resolve contradictions against the latest explicit specification.
4. Ask blocking questions immediately when requirements are materially unclear. Otherwise reply only `OK` and start work.

## Execute the specification

- Keep `.agents/PROJECT_CHECKLIST.md` current while working. Record active development, blockers, external follow-ups, and completed work.
- Work on the branch matching the delivery target:
  - `Dev`: upstream for new development and integration.
  - `main`: public web app and standard APK/Obtainium release, including Google OAuth and notifications.
  - `fdroid-prep`: F-Droid-compatible variant and submission preparation.
  - `archive/main-pre-8.0.0`: rollback archive only; do not develop on it.
- Preserve intentional differences between standard and F-Droid builds through configuration or isolated commits; avoid two unrelated implementations.
- Verify changes proportionally with lint, type checks, tests, production builds, release checks, and CI where applicable.
- Update the code map below whenever a substantial change alters architecture, ownership, major directories, release flow, or branch responsibilities.
- Finish only after the requested outcome is verified. Respond with `fatto` followed by an extremely concise checklist of completed items. Include remaining blockers only when any exist.

## Builds and deployments

- Trigger the requested build or deployment and verify only that the platform accepted and started it.
- Do not monitor GitHub, Dokploy, store, or other remote builds unless the PM explicitly asks. The PM will report failures for diagnosis.
- After launch, respond only `Build <target> in corso`, using a clear target such as `github`, `dokploy-production`, or `dokploy-dev`. This is the exception to the normal `fatto` response.

## Self-hosted Supabase

- Supabase runs in Dokploy on the project's VM. `.env.local` has separate `SELFHOSTED_DEV_*` and `SELFHOSTED_PRODUCTION_*` SSH settings, including host, user, key path, Compose project and database role. Never treat missing local Docker/Podman as a blocker for remote database work.
- Apply a reviewed migration from the repository root with `node scripts/selfhosted-db.mjs apply <dev|production> <migration.sql>`. Choose the target explicitly; production schema changes require explicit PM authorization.
- This runner connects over SSH, executes the migration inside the selected remote Compose `db` container as one SQL transaction, and records its SHA-256 in `app_private.schema_migrations`. It does not modify Supabase CLI migration history. After applying, run a read-only verification query over the same SSH target.
- `npx supabase status` only checks local Supabase containers. The repository's `scripts/blocked-linked-supabase-command.mjs` intentionally rejects linked/local QA commands; use the SSH runner for this self-hosted setup.

## Current code map

- `app/`: Next.js 16 App Router pages, layouts, and API routes for the web application.
- `components/`: shared web UI and feature components.
- Arena settings editor: `components/arena/arena-settings-editor.tsx` owns draft, metadata/season commands and modal; the table route composes opening, season refresh and metadata application. Commands are guarded/aborted on close and unmount, with account/group opening keys and scoped acknowledgements; two-step save atomicity remains a follow-up.
- Admin user reports: `/admin/users` uses the existing login/administrator role; `hooks/use-admin-users.ts` owns URL/filter/request lifecycle, `components/admin/admin-users-panel.tsx` presentation, `/api/admin/users` session/role/rate limits and export, `lib/admin-users-server.ts` service-only aggregate RPC. See `docs/ADMIN_USER_REPORTS.md`; no privileged client in browser code.
- `lib/`: web domain logic, authentication, data access, validation, and security utilities.
- Feature import gates: `scripts/verify-feature-boundaries.mjs` checks data/presentation ownership, platform runtime separation and reachable cycles from the four target entrypoints and explicit feature inventory in both quality commands. Existing image-container delegation is narrow and tested.
- Scryfall card JSON: `packages/data/scryfall-transport.ts` owns per-runtime pacing, Retry-After, shared inflight work, subscriber aborts, deadlines and bounded public metadata cache. Web/server/Expo adapters retain mappings and outer caches. Static images are separate. No distributed quota guarantee across replicas/devices.
- Web deck outcomes: `components/profile/deck-outcome-chart.tsx` owns lazy-loaded Recharts rendering only; existing profile aggregates and win-rate calculations remain independent, native keeps its own renderer.
- `packages/domain/`: pure shared rules for win rate, participant identity and provisional rankings; legacy web/mobile import paths remain compatibility adapters. Both quality gates enforce platform-free imports and acyclic dependencies.
- Arena-day grouping is owned by `packages/domain/arena-session.ts`; both platform paths are compatibility exports. Preserve conditional previous-calendar-day grouping at08:00UTC when changing history pagination; the unconditional timestamp-shift helper alone does not define a full arena day.
- History foundation: `packages/domain/arena-history.ts` validates scoped versioned pages/summaries and microsecond ordering; `packages/data/arena-history-query.ts` owns shared transport, with web/native compatibility paths. Private group revision metadata and statement triggers invalidate traversals after match/participant writes. `packages/data/request-deadline.ts` owns transport cancellation/timers; legacy live timeout naming and error text remain adapters. See `docs/DEV26_HISTORY.md`; web history/season/aggregate/export controllers are integrated locally pending browser validation; native history integration remains open.
- Web game journal: `lib/live-game-journal-types.ts` owns types, `lib/live-game-journal-contract.ts` validation, `lib/live-game-offline.ts` account/group storage and acknowledgement-scoped removal; `components/live-game/web-journal-warning.tsx` renders persistent errors. Native outbox/shadow copies remain separate pending lifecycle refactoring. See `docs/DEV26_WEB_JOURNAL.md`.
- Web completed recap: `components/live-game/web-completed-game.tsx` owns recap/rematch confirmation UI and the sorted setup snapshot; its caller owns game creation, journal, setup restoration and navigation. Recap transformations import the pure engine directly.
- Web tracker setup: `hooks/use-web-tracker-setup.ts` owns draft/storage/occasional catalog additions and image preload; `components/live-game/web-tracker-wizard.tsx` renders the setup and composes the existing OccasionalDeckForm container. `lib/types/web-tracker.ts` is the canonical web tracker view contract, re-exported for compatibility.
- Web tracker display: `hooks/use-web-tracker-display.ts` owns fullscreen/orientation and table measurement resources. Game identity/commands/journal remain with WebLiveGame; the table observer follows a stable DOM callback ref, and document display leases guard late fullscreen/orientation completions.
- Shared live engine: `packages/domain/live-game-*.ts` owns models, summaries, state/mutations/results and undo/redo. `packages/data/live-game-runtime.ts` supplies clock/RNG compatibility defaults; web/native legacy paths re-export it. `match-datetime-runtime.ts` similarly supplies the current-date fallback outside pure domain. Gates reject ambient clock/RNG in domain.
- Shared sync presentation: `packages/domain/live-game-sync-presentation.ts` owns acknowledgement-based states, pending-command counts, auth classification and IT/EN status instructions. `WebSyncBadge` owns web presentation timers; native `table-arena` consumes the same state/copy. `expo/lib/live-game-journal-writer.ts` serializes snapshots without hiding durability errors from archival callers.
- Analytics dashboard v2: `packages/domain/analytics-dashboard*.ts` owns complete-report validation and count transformations; the isomorphic `expo/lib/analytics-dashboard-query.ts` plus web compatibility export owns deadlines/cancellation. `hooks/use-dashboard-analytics.ts` owns account/scope request lifecycle; native uses the v2-suffixed existing personal query key. Admin global API preserves its old analytics field and adds the validated report with private headers. SQL/QA and remaining profile/history work: `docs/DEV26_ANALYTICS.md`.
- Profile Archidekt account settings: `hooks/use-profile-archidekt-settings.ts` owns settings drafts/save/profile acknowledgment, while `components/profile/profile-archidekt-settings-panel.tsx` is typed presentation in the account slot. Initial extraction preserves behavior; cancellation/default-prefill coupling and its dependency warning remain follow-ups.
- Profile commander editor: `hooks/use-profile-commander-editor.ts` owns the saved-deck commander/art editor, options/loading/save state and the three existing load/open/persist commands. Catalog updates use its scoped caller setter. Editor sessions scope open/art/save commands, cancellation and snapshot acknowledgments through the shared profile command lease; known CMC survives art-only edits when optional lookup fails.
- Profile public Archidekt preview: `hooks/use-profile-archidekt-import.ts` owns username/catalog/selected-source state and the read-only public-catalog command; account settings still prefill through its setter, persistence commands remain in the route. Public preview normalization uses three workers and propagates cancellation through metadata repair.
- Profile URL preview: `hooks/use-profile-url-import.ts` owns URL input, preview/commander/art state and read-only import commands. `hooks/use-profile-commander-arts.ts` owns shared browser-first art lookup/fallback; callers own selection/lifetime. Import/art jobs use `use-profile-command-scope.ts` account/role and modal-phase leases with single-flight/replacement,15s transport deadlines and typed reset/select commands; raw preview setters no longer escape.
- Profile commander search: `hooks/use-profile-commander-search.ts` owns manual/partner query/results/busy state, debounce timers and request controllers. Two independent search channels own context-scoped drafts,400ms timers,15s deadlines and cancellation on input/modal/scope/navigation changes. Real account/role transition certification remains separate.
- Profile commander metadata: `lib/profile-commander.ts` owns browser Scryfall search/fallback, public art caches and imported preview/color preparation. Original mapping, storage key and function bodies are preserved; private account/deck drafts remain in feature controllers.
- Profile directory: `hooks/use-profile-directory.ts` owns directory load, drafts and nickname persistence; `components/profile/profile-nickname-directory.tsx` is admin presentation through typed controls, with the unchanged contract in `lib/types/profile-directory.ts`. Directory requests/setters are scoped to account/admin context, cancelled on cleanup with15s deadlines and guarded per target against duplicate writes. Account nickname commands additionally cancel on panel switching; real account/role transition certification remains open.
- Profile credentials: `use-profile-account-credentials.ts` owns nickname/panel state; `use-profile-password-change.ts` owns scoped password drafts, cancellation and single-flight commands. `lib/profile-password.ts` verifies with an isolated, nonpersistent SDK client, restores the original session only in its private memory, updates under that session and revokes only temporary verification; cleanup is bounded and does not delay an acknowledged update. `profile-account-panel.tsx` is presentation with an Archidekt slot. Nickname drafts/panel are account-scoped; nickname commands cancel on panel switching and navigation. `scripts/run-dev26-password-qa.mjs` performs Dev-only disposable Auth QA with notification checks and verified cleanup.
- Web profile catalog: `hooks/use-profile-catalog.ts` owns keyed catalog state, requests and scoped local updates. `use-profile-metadata-enrichment.ts` owns idle scheduling, color/bracket/CMC jobs, progress and pause/cancellation; the route passes a successful catalog load and its original color resolver. `lib/types/profile-deck.ts` owns view contracts. Shared `delay` supports AbortSignal; `runWhenIdle` returns a disposer. Browser account/admin lifecycle coverage and further profile owners remain open.
- Profile analytics v2: `packages/domain/profile-catalog-metrics.ts` validates complete scoped reports and derives counts; web `use-profile-metrics` and native `use-profile-decks` own request lifecycle. `expo/lib/profile-catalog-pages.ts` traverses revision-checked UUID pages with cancellation and bounds; web compatibility exports retain platform boundaries. Admin catalog/metrics APIs authorize before service-only RPCs. Legacy RPCs remain for installed clients; new clients do not fall back to capped participation queries.
- `tests/`: web unit, integration, security, end-to-end tests, and snapshots.
- `expo/`: Expo SDK 57 / React Native client.
  - `expo/app/`: Expo Router screens and navigation.
  - `expo/components/`: mobile UI and feature components.
  - `expo/lib/`: mobile domain, API, authentication, and platform services.
  - `expo/plugins/`: native Expo configuration plugins.
  - `expo/tests/`: mobile test suites.
- Archidekt arena sync: `app/api/arena-archidekt-sync/route.ts` owns authentication/membership/opt-in; `lib/archidekt-sync-server.ts` owns fresh bounded imports; private atomic SQL helpers save target decks. Expo wizard consumes explicit results through `expo/lib/arena-archidekt-sync.ts`; legacy queue remains for older clients. See `docs/ARCHIDEKT_ARENA_SYNC.md`.
- Push delivery 9.1.3: `expo/lib/push-device.ts` owns native registration and logout; `lib/push-delivery-worker.ts` processes transactional `push_delivery_queue` via service-only claims; `app/api/internal/push-delivery/route.ts` requires worker secret; `ops/systemd/21life-push-delivery@.*` schedules the caller. Session revocation RPCs prevent delayed registration after logout. See `docs/RELEASE_9.1.3_DEV.md`.
- `supabase/`: self-hosted backend configuration, migrations, and Edge Functions.
- `scripts/`: build, verification, release, and operations automation.
- `ops/`: VM services and deployment-retention automation.
- `.github/workflows/`: CI and signed Obtainium release automation.
- `fastlane/metadata/android/`: canonical public store listing metadata.
- `fdroid/metadata/`: local F-Droid build recipe; the official submission is reviewed on GitLab.
- `docs/`: current release-readiness, legal, provenance, and operating documentation.

## Persistent checklist

Use `.agents/PROJECT_CHECKLIST.md`. Keep it concise and never create a competing task ledger.
