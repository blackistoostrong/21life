# DEV26-10 — Private playgroup recap

The existing private statistics share action now opens a seven- or thirty-calendar-day preview on web and native. Today is included, with local calendar boundaries and the device time zone shown. Names are anonymous on every opening; including names and exporting require explicit user actions. Invitations and individual match exports retain their separate flows.

## Data and ownership

The existing revision-checked v2 history traversal reads the complete selected interval, independently of visible pages and report filters. Limits are 5,000 matches, 16 MiB and a single 30-second budget. Incomplete, incompatible or denied results produce an error rather than a partial recap. No RPC, migration or dependency was added.

`packages/domain/arena-recap-period.ts` owns injected-clock calendar boundaries; `arena-recap.ts` owns aggregation. `packages/data/arena-recap-source.ts` projects only required historical metadata. `packages/features/arena-recap/` owns preview state, IT/EN text and explicit export commands. Platform hooks capture actor/JWT and bind committed callbacks; controlled dialogs present their state. Closing, switching account/group or changing the period cancels the old read and prevents late feedback from crossing openings.

Wins, draws and unknown results remain distinct. Missing identities/commanders and unavailable durations are explicit. Manual zero-duration records are not treated as measured zeroes. The median displays its measured sample against the complete match count. Historical snapshots preserve commander/name context after normal collection deletion. Anonymous player aliases are deterministic within the recap; output contains no raw IDs, invitation codes, notes, log or email fields. Opted-in user-provided names are not content-redacted.

Copy reports success only after clipboard acknowledgement. Download exports the exact displayed UTF-8 text. Share is invoked within the initiating gesture and cancellation is neutral; opening a system share sheet does not claim publication. See the official [React Native Share contract](https://reactnative.dev/docs/share) and [Web Share contract](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).

## Verification

Runtime candidate: `6f6682b3897ab803288df03c9896b4b28fe4f021`, version 9.3.0/90300, Dev only.

- Complete quality: 1,061 web tests plus 80 script tests; 867 native tests. Existing seven web/three native skips remain unchanged. Coverage ratchets pass for 163/151 files with previous floors preserved.
- 42 browser checks: 28 web UI and 14 actual native React-hook/SDK checks with platform I/O replaced. Includes privacy defaults, exact preview/export parity, user activation, cancellation, denied/oversize sources, period changes, account/group/unmount isolation and stale acknowledgements. These are not native renderer or device proofs.
- Clean web build: 56 routes, JavaScript 3.56/18 MiB. Android and iOS Dev exports on the same runtime SHA: JavaScript 9.48/12 MiB. These are not APK/IPA releases.
- 14 authenticated desktop/mobile checks passed against the compiled candidate and real Dev backend: four recap cases plus ten preset/live-command regressions. Recap cases cover empty history, manual wins, draws, guests, normal personal-deck deletion with historical readback, names opt-in, exact clipboard preview and scoped request cancellation. Disposable fixture cleanup verified.

Initial authenticated fixture failures came from using privileged writes/deletes instead of the normal actor-bound collection flow, omitting the required guest normalized name, and attempting an occasional-deck deletion without a corresponding product flow. The final fixture uses an authenticated member, a manual personal deck and normal deletion; it verifies `source_type=historical`. Read-only Dev trigger inspection established the distinction. No database guard was relaxed or product behavior changed to accommodate those fixtures.

Final fixture corrections and documentation do not change the runtime above. Integration proof belongs in the project checklist and PR283. Physical native renderer, device/touch and image review remain in the final validation phase requested by the PM. No production changes or new APK publication were performed.
