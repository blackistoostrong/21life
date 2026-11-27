# Local table presets — 9.3.0 Dev

The live setup supports up to ten named presets for each account and playgroup. Both clients offer save, preview/load, rename and confirmed deletion. Names contain 1–40 Unicode code points after trimming/NFC normalization and are unique without case distinctions within their scope.

Stored v1 documents contain account/group identity, preset identity/name/version/timestamp, seat order and participant/deck references, deck kind, initial life and the existing layout preference. They contain no credentials, running life/counters, timer, history, card payload or decklist. Data stays in the current browser or device; it has no cloud or public-sharing path.

Loading requires an explicit confirmation. Only selected IDs are re-read against current membership and deck availability. Missing, archived or unauthorized references remain unassigned with a setup warning. Valid references outside picker page caps receive a bounded selected-only metadata projection. Applying goes to seat review and cannot start a round or create an occasional deck.

## Ownership

- `packages/domain/table-presets.ts`: versioned DTO and naming/limit/scope policies.
- `packages/data/table-preset-storage.ts`: fresh reads and acknowledged CRUD, accepted-operation ordering per storage key, cancellation and failure isolation.
- `packages/data/table-preset-references.ts`: current reference validation through the existing bounded round-reference reader.
- `packages/features/table-presets/`: portable controller, strict codec factory and IT/EN copy. Platform codec adapters inject their already installed Zod runtime; Metro watches only this feature folder, without importing web services or web node_modules.
- Web/native hooks bind callbacks after React commits. Each command captures those callbacks and owns its cancellation. Keyed UI openings discard private form state on account/group changes.
- Web Locks protect complete localStorage transactions across tabs. AsyncStorage uses the same repository ordering within the native runtime.

Invalid and future-version documents are preserved, with visible errors. Storage failures preserve the current setup. A cancelled operation cannot publish into another opening/account; an already accepted local write may still finish in its original scope.

## Verification

Runtime candidate: `987e60954432bbdc9b51fccfd2f21b27fd729a70`, version9.3.0/90300, Dev only.

- Complete quality: web990 tests +80 script tests, native796 tests. Existing seven web/three native unit skips unchanged. Coverage ratchets158/146 files; previous floors and aggregate thresholds preserved.
- 44 desktop/mobile browser tests: real web controls/keyboard/Escape/focus and IT/EN errors; actual native React hooks/SDK transport with only platform I/O ports replaced; actual browser storage/Web Locks across tabs. Includes restart, scope changes, late responses, missing/archived references, quotas, future schemas and storage failures.
- Clean web build56 routes, JavaScript3.56/18MiB; Android and iOS Dev exports on the same SHA, JavaScript9.45/12MiB. Exports are not APK/IPA releases.
- 10 authenticated desktop/mobile Dev checks passed on the compiled candidate: preset CRUD/restart/fresh references/no automatic round, existing command cancellation/offline behavior and a new synced rematch. Disposable fixture cleanup verified.

The first Android export on830ad708 failed because Metro could not see web-lib re-exports. The portable feature boundary and injected Zod runtime fixed that build issue; both final exports above succeeded. The earlier web build does not stand in for the corrected candidate.

Physical native renderer, device/touch and image review remain in the final project validation phase requested by the PM. No database migration, dependency addition, production change or APK publication was performed. Integration status is recorded in `.agents/PROJECT_CHECKLIST.md` and PR282.
