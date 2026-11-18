# DEV26 — Architettura e responsabilità

Versione candidata 9.3.0; base Dev bac40b9c. Documento di lavoro: **refactoring delle schermate parziale**, non attestazione di completamento del punto6.

## Confini già introdotti

`packages/domain` contiene un'unica implementazione di win rate, identità partecipanti e visibilità ranking. Web e mobile mantengono adapter ai percorsi precedenti. Nessuna dipendenza React/Next/Expo/Supabase/storage nel dominio. Il controllo AST `verify-domain-boundaries.mjs` rifiuta import esterni, accesso a globali di piattaforma e cicli; entrambi i quality lo invocano.

Coverage: mantenute le soglie dei vecchi adapter e aggiunte le stesse soglie alle implementazioni condivise. Il mobile raccoglie esplicitamente coverage dei file esterni tramite percorso assoluto e allowExternal; senza questa configurazione Vitest ometteva i file e il ratchet ha correttamente fallito. Non sono state abbassate soglie.

## Proprietari attuali e destinazione

| Proprietario attuale | Responsabilità da separare | Confine desiderato |
|---|---|---|
| app/table/[id]/page.tsx | catalogo/membership, match editor, storico, analytics, inviti | controller per feature e route compositiva |
| app/profile/page.tsx | ricerca/import carte, catalogo mazzi, editing, premi, analytics | servizi ricerca/import, controller collezione, pannelli |
| components/live-game/web-live-game.tsx | setup, journal, sync, lifecycle, dialoghi, finalizzazione | controller lifecycle/sync, UI tavolo e dialoghi |
| expo/app/table/[id]/play.tsx | stato locale, outbox, listener, setup, finalizzazione e rivincita | controller equivalenti con adapter nativi |

Le estrazioni sono parziali e non soddisfano ancora i quattro target dimensionali. Non trasferire ogni riga in un unico useController: ogni query/subscription/journal deve avere un proprietario unico con cleanup e contratto documentati.

## Punti di manutenzione già unificati

- Regola win rate: packages/domain/win-rate.ts, usata da entrambi i client.
- Identità utente/ospite: packages/domain/participant-keys.ts.
- Soglia provvisoria e filtro: packages/domain/deck-ranking-visibility.ts.

Restano da dimostrare i percorsi recap, errore sync e setup richiesti da11d, i lifecycle account/gruppo e i limiti dimensionali delle quattro schermate. Non dichiarare completato DEV26-11/12 con il solo dominio comune.

## Confini aggiunti durante il rafforzamento sync

`packages/domain/live-game-sync-presentation.ts` possiede gli stati e i conteggi condivisi, la classificazione degli errori di autenticazione e le istruzioni IT/EN. Il cambio di significato di un errore sync ha ora un punto comune ai client, coperto dalle rispettive suite. `WebSyncBadge` possiede esclusivamente i timer di visibilità/annuncio e la presentazione; non accede a Supabase o al journal. L'adapter storage web delega la validazione al contratto separato e conserva tipi di compatibilità. Il writer nativo serializza le scritture e preserva gli errori per i chiamanti che richiedono durabilità; il controller resta proprietario della catena e della sessione.

Questi sono confini preparatori necessari a DEV26-05. Non sostituiscono la scomposizione dei quattro target, l'audit dei lifecycle o le prove di manutenzione11d. Nessuna riduzione globale delle responsabilità delle quattro schermate è ancora certificata.

## Baseline strutturale misurata (AST)

| Target | Righe non vuote | useState | useEffect |
|---|---:|---:|---:|
| Tavolo web |4159|75|13|
| Profilo web |3555|63|10|
| Partita web |1718|43|15|
| Partita mobile |2140|37|12|

Inventario dettagliato in artifacts/dev26/architecture-before.json (locale ignorato). Il successivo step profilo estrae richieste/contratti e rimuove scansioni raw e fallback; `use-profile-metrics`, i moduli condivisi `profile-catalog-*` e le API admin possiedono ora questi confini. Questo avanzamento non costituisce ancora la misura dopo e le prove11d dell'intero refactoring: tavolo e schermate partita restano da scomporre. Le verifiche aggiornate sono nella checklist e in DEV26_ANALYTICS.md; i vecchi conteggi394web/352mobile rappresentano solo la baseline storica.

Misura intermedia dopo profilo (AST, artifact `architecture-after-profile.json`): tavolo4159righe/75state/13effect; profilo3483/63/11; partita web1745/45/14; partita native2227/40/13. I nuovi controlli di sicurezza hanno aggiunto stato nelle partite: non c'è ancora la riduzione strutturale richiesta dal punto6. Queste cifre sono una diagnosi, non una certificazione di11d.

Il raggruppamento UTC dei giorni arena passa a `packages/domain/arena-session.ts`, con soli re-export compatibili web/native. Estrazione meccanica: conservate soglia08:00UTC e condizione del giorno precedente presente, inclusi i test del caso isolato. Lo step storico successivo deve distinguere quel contratto dalla vecchia funzione di semplice shift: non usare range08:00–08:00 come sostituto del raggruppamento condizionale.


## Native history and catalog ownership checkpoint

`expo/hooks/use-arena-history.ts` owns versioned history requests, parent-context cancellation, revision/cursor continuity, explicit cached/error/loading states and native page accumulation. `useArena` coordinates metadata/cache writes and supplies legacy cache rows without treating them as complete reports. Context keys mask old metadata before effects; late reads and subscription replies cannot overwrite the new account/group. An explicit metadata error replaces an indefinite loader. `expo/hooks/use-arena-day-export.ts` owns complete-day preparation and cancellation; export selection captures account/group/day/period and intro together, with an acknowledgement scoped to the selection ID. Presentation components receive counts/status/callbacks and do not create queries or subscriptions. The legacy raw native match reader was removed.

Native conformance tests execute the same shared query/serialization contract as web. Additional owner tests cover cached counts, late group replies, account masking before effects, superseded requests, duplicate load-more presses, metadata failure, export cancellation and null-date editing/sharing. These are controller/component tests, not a physical-device certification. Native history remains an all-time traversal with explicit partial-page counts; server-side period filtering, full catalog traversal, aggregate/fallback invalidation and final device checks remain unfinished. The four large entrypoints still do not satisfy the final size/ownership gates.


## Arena settings editor: mechanical boundary

`components/arena/arena-settings-editor.tsx` owns the opening snapshot, six local state cells, metadata write, conditional season command, feedback and modal presentation. The route retains only the open flag, passes the existing season reload command and applies the returned metadata. This is a feature container with SDK access, not a presentational component. Existing authorization remains server-side; the existing trigger visibility is unchanged.

The extraction preserves markup, classes, draft defaults, trim semantics and the metadata→season→reload sequence. Browser characterization against the preceding built candidate passed desktop/mobile (2/2): cancel discards drafts, empty name disables saving, month dropdown works, rejected metadata leaves the editor open and never invokes season mutation, success targets the current group and applies trimmed fields. Network writes are intercepted; these checks do not certify database permissions. The rebuilt extracted candidate must pass the same checks before this boundary is considered verified.

Remaining pre-existing risks are explicitly separate from this mechanical commit: metadata and season writes are not atomic, and late editor completion is not yet context guarded. This slice does not close DEV26-11/12 or establish the four entrypoint size gates.


The extracted candidate8a699662 passed the same desktop/mobile browser characterization (2/2), a clean web production build (56routes), full web quality (690+7skip;58script;126ratchet files). Optional SQL fixture payloads were absent in this quality invocation; final checks must supply all three. ESLint and Playwright must run sequentially because Playwright recreates test-results.

The following behavior fix is separate: the editor owns one cancellable command at a time, a15second transport deadline per write and a guarded continuation chain. Closing or unmounting aborts transport and suppresses subsequent commands/feedback. The route keys opening by account/group, masks an old editor immediately and only applies returned fields to the same group. Cancellation does not roll back a server-committed write; the old two-command save is still not atomic. Browser red proof on8a699662: cancellation left the pending PATCH signal active. Cancel/reopen and SPA navigation/back regression checks target the actual React editor with interception only at the network boundary.


## Confini automatici delle feature (11c)

`scripts/verify-feature-boundaries.mjs` integra il controllo del dominio nei quality web e native. Usa AST TypeScript e resolver del client effettivo: controlla tutti i moduli data, i quattro entrypoint obbligatori, la schermata tavolo native e i controller/pannelli estratti elencati nel manifesto `featureOwners`. Le nuove feature devono estendere quel manifesto. Risolve anche barrel, import dinamici statici e require; rifiuta accessi a moduli calcolati. Il grafo runtime raggiungibile deve essere aciclico, senza runtime Next nel native o Expo/React Native nel web. Le dipendenze locali web→UI native e native→UI web sono vietate; adapter legacy isomorfici in expo/lib rimangono possibili soltanto se la loro chiusura non importa runtime native.

I trasporti data possono importare soltanto domain/data, anche per i tipi. La presentazione non può raggiungere SDK Supabase, proprietari del journal o trasporti data attraverso wrapper locali. I type-only import non allocano risorse e non costituiscono archi runtime. La composizione del pannello guest native delega esplicitamente al container immagini `expo/components/deck/deck-image.tsx`, che già possiede caricamento/cache immagini: questa singola frontiera non consente SDK direttamente nel pannello, come prova una regressione. Il ciclo di vita del container immagini rimane distinto da quello delle query guest. Il controllo non analizza internamente i pacchetti npm e non sostituisce gli export/build reali né l'audit lifecycle.

Il primo controllo ha rilevato un ciclo reale web: `deck-collection-analytics → deck-commander-cmc → deck-collection-analytics`. Ora entrambi dipendono da `lib/deck-commander-names`, mentre la normalizzazione testuale vive in `packages/domain/commander-names`. Gli export precedenti restano compatibili. La diversa vecchia normalizzazione native non è stata cambiata incidentalmente. I test condivisi eseguono la regola pura sotto entrambi i resolver; deduplica dei lookup, priorità opzioni, cache e limiti del batch sono verificati separatamente. Nessuna soglia di copertura ridotta dopo l'estrazione.

```mermaid
flowchart TD
  Web[Route web] --> Editor[Container editor impostazioni]
  Web --> WH[Controller storico / analytics / season]
  Editor --> SDK[SDK Supabase]
  WH --> Data[packages/data]
  Data --> Domain[packages/domain]
  Native[Route native] --> NH[Controller native]
  NH --> Data
  UI[Presentazione] --> Domain
```

| Risorsa | Proprietario | Uscita / cambio contesto |
|---|---|---|
| Draft e comando impostazioni web | ArenaSettingsEditor | Abort su chiusura/unmount; guardia continuazioni, deadline15s e invio unico |
| Apertura editor / applicazione metadata | Route tavolo | Key account+gruppo, mascheratura immediata e ack per stesso gruppo |
| Storico web e cursori | useArenaMatchHistory | Abort/epoch; dati mascherati sul cambio scope |
| Statistiche complete e premi season | useArenaAnalytics web/native | Chiavi account/gruppo/periodo/bracket; abort richieste precedenti |
| Season web / foreground | useArenaSeasonContext | Abort e rimozione listener/timer; errore esplicito |
| Storico/cache native | useArenaHistory + coordinamento useArena | Accumulo revisionato, cancellazione e mascheratura contesto |
| Export giorno | useArenaDayExport di piattaforma | Traversal completo, abort e nessun export parziale; dialogo web ancora nella route |
| Catalogo/membership web | Route tavolo (da estrarre) | Lifecycle e traversamento completo ancora da completare |

Misura intermedia della tranche editor, contro01faad78: route3934→3801righe non vuote, useState70→64; editor194righe non vuote con6stati e1cleanup. Il route effect aggiunto per azzerare l'apertura contestuale è intenzionale. Il candidato0fa75a83 ha superato buildweb56route e browser desktop/mobile12/12, inclusi annullamento e navigazione/back con PATCH sospesa e abort osservato. Il limite800rimane ampiamente non raggiunto: il punto6 resta aperto.


## Web tracker display boundary

`hooks/use-web-tracker-display.ts` owns the table ref/size, fullscreen state/listener, orientation entry/restore and ResizeObserver cleanup. It receives only the current record identity/reference plus copy/notification functions; it cannot access Supabase, journal or game commands. `WebLiveGame` consumes that display contract. Mechanical extraction preserves full-record observer dependencies and existing fullscreen timing. Any observer churn or late fullscreen completion fixes require their own regression and behavior commit.

Characterization before extraction on candidatee23efe2e passed the real4player/2client critical flow desktop/mobile2/2: offline recovery, simultaneous commands,401, quota failure, lost finalization response and exactly2saved matches with verified cleanup. Typecheck/lint and the expanded runtime graph gate pass after extraction; build and browser verification remain required. This does not complete game lifecycle/sync separation or prove physical orientation behavior.


Extracted display candidate2c78542d passed its clean56route build and the same real critical flow desktop/mobile2/2, with exactly2saved matches and cleanup verified. A subsequent behavior regression on that built candidate proved observer churn: one life mutation increased created observers1→2 while active remained1. The separate fix binds a stable callback ref to the actual DOM surface and ignores obsolete callbacks after detach. It deliberately does not depend only on record ID, which can be available before a cached game's surface mounts after bootstrap. Browser assertions cover no recreation after mutation, observation after reload and zero live table observers in the recap. Pending fullscreen promises after unmount remain a separate audit item.


Observer fix candidatefb8df020 passed a clean56route build and the instrumented real4player/2client flow desktop/mobile2/2: observer stable on mutation, active after reload/cache recovery and detached in recap. Exactly2matches and fixture cleanup were verified. This is a DOM resource ownership check; pending fullscreen/unmount and full account/group controller lifecycle remain open.


## Fullscreen asynchronous ownership

A browser regression onfb8df020 proved a late completion bug: after pausing and unmounting the tracker, resolving its pending fullscreen request still increased orientation locks1→2. The next behavior fix adds document-scoped opaque display leases, a single pending fullscreen request and guarded continuations. A late rejection cannot notify a departed tracker; a late success restores document fullscreen only when no newer tracker claims display. Late orientation locks release when their owner is gone and no newer owner needs them. The WeakMap contains only a boolean resource lease per Document, never actor/game data. It coordinates one browser-wide resource rather than sharing business state across accounts.

The actual React/browser tests defer fullscreen resolution/rejection at the browser API boundary, pause through the existing UI and assert no new lock/fullscreen/error toast after departure. Their live games use disposable Dev users; authenticated fixture cancellation follows the same policy as normal cancellation. Physical browser/PWA orientation behavior, full account/group reset and all four entrypoint structural targets remain final/open gates.


Fullscreendadecac0 verified: full web quality699+3skip/66script/128ratchet, clean56route build and desktop/mobile browser8/8. Cases include the instrumented critical4player/2client flow, deferred fullscreen success/rejection after pause and remounting a new tracker before old completion. Exactly2matches, authenticated cancellation of disposable pending games and group/Auth fixture cleanup passed. No native build changes or physical certification in this web-only slice.

| Intermediate target after display | Nonempty lines | useState | useEffect |
|---|---:|---:|---:|
| Web table |3801|64|11|
| Web profile |3483|63|11|
| Web game |1653|43|11|
| Native game |2227|40|13|
| Web display hook |156|2|2|

Measured with TypeScript AST; ignored artifact `architecture-after-display.json`. All four entrypoints still exceed800lines. Next extraction owns setup persistence/draft/catalog additions separately from wizard presentation; preserving rematch and sticky wizard layout is mandatory.


## Web setup and wizard extraction

`useWebTrackerSetup` owns the setup draft, nine state cells (including occasional catalog/busy state), existing per-account/group v1 storage, last-deck selection and art preloading. The game controller invokes its persistence command and keeps the existing durability feedback; it owns game creation/journal and does not duplicate setup writes. Rematch reselection uses the same restore command without changing the four-field snapshot or resetting additional UI state. `WebTrackerWizard` renders setup, seats/deck search/layout preview/sticky controls. It receives one feature controller plus scoped context/status/navigation commands, rather than the game/journal controller. The existing `OccasionalDeckForm` remains the authorized HTTP/container owner and is an explicit presentation delegate. Shared tracker view types move to `lib/types/web-tracker` with old component type exports preserved.

This mechanical extraction preserves storage keys, draft initialization, conditional search, occasional-seat guard, classes, labels and action order. Account/group draft reinitialization and stale callbacks require a separate behavior change; moving state is not a claim that those old lifecycle problems are solved. Baseline golden wizard previews2/2 and the real critical/fullscreen8/8 checks passed before extraction; new candidate checks remain required. No native behavior or SQL changes.


Setup extraction checks before build: full web quality699+3skip/66script/128ratchet PASS, runtime graph and8guard regressions PASS. The old static occasional contract was updated to follow the extracted owners while retaining automatic-selection/private-catalog assertions and adding wiring checks. AST: WebLiveGame1653→1270nonempty lines and43→34state cells; setup controller81lines/9state/1effect; wizard345lines/0state/0effect. The entrypoint still exceeds800and game sync/finalization/dialog ownership remains unfinished.


Setup/wizard84ad4a05 verified: clean56route build and browser desktop/mobile10/10, including unchanged pod2–6goldens, real4player/2client recovery/finalization and observer/fullscreen/new-owner cases. Exactly2saved matches and fixture cleanup passed. No golden/tolerance changes. Next shared-domain boundary is the existing single engine in expo/lib/live-game: split models/events/mutations/results, leaving clock/RNG defaults in compatibility adapters. This is still partial point6; WebLiveGame1270and the other targets remain above limits.


## Shared live engine, history and clock boundary

The existing single engine is split into `packages/domain/live-game-types`, `live-game-events`, `live-game-players`, `live-game-mutations`, `live-game-results` and `live-game-state`; the scoped `live-game` facade preserves the public feature contract. Models own the canonical layout variant type, re-exported by the old geometry path. Pure history moves to `packages/domain/live-game-history`. Clock and RNG are required inputs to pure mutations/selection, including recursive group/drain/last-standing calls. `packages/data/live-game-runtime` preserves installed clients' ambient defaults and both platform import paths delegate to it. This is a shared IO adapter, not pure domain logic.

The purity gate now rejects ambient Date construction/Date.now/Math.random; explicit date parsing and injected providers remain valid. The previously shared datetime helper still hid a current-date fallback: its domain input is now explicit and `match-datetime-runtime` retains the existing platform API/defaults, including null-history behavior. Existing clock behavior is preserved rather than silently replacing KO time with mutation time.

A local oracle loads the actual old engine0f40a647 and the extracted implementation under the same controlled clock/RNG.1382comparisons passed across21public functions,26runtime exports,2/4/6players, mutations/recursion/drain/counters/emblems/normalization, history and dates; outputs, ambient call counts and input immutability match. Original source/report remain ignored local QA artifacts, not a second product implementation. Committed deterministic conformance tests execute the same rules under both resolvers; a frozen public API fixture checks compatibility. Typecheckweb,27targeted tests and import gates pass; complete quality, reviewed coverage floors and real build/export/browser checks remain required.


Pre-build verification for the engine extraction: web quality707+3skip/67script and native quality511PASS. Ten new reviewed per-file floors per client preserve the measured extracted implementations; existing floors are unchanged. Ratchets138web/130native PASS. Shared tests cover injected recursive clocks, atomic group/drain versioning, RNG consumption, default compatibility, bounded undo/redo and legacy recovery; the original web API rule tests also execute through the native resolver. Build/export and browser checks still pending at this checkpoint.


## Engine checkpoint752667a1 verified

Web quality707+3skip/67script and native511PASS; expanded ratchets138/130PASS with existing floors unchanged. Clean web56route build and Android/iOS exports PASS; web2.85/18MiB and Android9.32/12MiB budgets PASS. Browser desktop/mobile12/12PASS: unchanged wizard goldens, real4player/2client recovery/finalization, observer/fullscreen/new-owner checks and complete history/null/revision/export. Exactly2matches and fixture cleanup were verified. Engine source modules range8–214nonempty lines; API/defaults are preserved, backed by1382oracle comparisons and shared conformance tests.

This closes the current shared-engine tranche. Point6 and the original plan remain open: four entrypoints still exceed800lines, the complete account/group/sync/journal/finalization owners, profile/table decomposition and final maintenance-path proofs remain required. Physical device checks are deferred to the final candidate per PM. Resume from the sole ledger `.agents/PROJECT_CHECKLIST.md`; worktree/branch and remaining tickets are recorded there. PM requested PC shutdown after closing/saving the current task near the context margin; no further feature tranche starts in this shutdown window.


## Web completed-game presentation (2026-11-18)

`WebCompletedGame` owns recap presentation, the existing rematch confirmation and the slot-sorted previous setup snapshot. The session controller still owns creation, journal/finalization, setup restoration and navigation; the panel receives typed commands. Markup, labels, confirmation and action order are preserved. The reachable recap builder now imports only pure engine functions directly, rather than pulling ambient IO defaults through the compatibility facade; the presentation gate caught that dependency without a new exception.

Before extraction, the built752667a1 critical flow passed desktop/mobile2/2; enhanced characterization also passed2/2 for cancel confirmation and restore/reselect. After a recovered finalize/reload, the wizard opens at its existing first step; the test navigates to step4 before checking restored seats, preserving that behavior. The initial contrary test expectation was corrected without changing the app. Exactly2matches and fixture cleanup passed. Source typecheck/lint/import gate pass; quality/build/export/browser after extraction remain pending.

Intermediate WebLiveGame1270→1192nonempty lines and34→33state cells; panel107lines/one local state. The800line target and full sync/journal/lifecycle decomposition remain open. This extraction does not complete rematch feature08.


Completed-game candidate0ee34b64 verified18-11: full qualityweb707+3skip/67script and native511PASS, ratchets138/130 unchanged. Clean56route build, Android/iOS exports and budgets2.85/18MiB web,9.32/12MiB Android PASS. Browser desktop/mobile10/10PASS including rematch confirmation cancellation, restored setup/reselection, real4player/2client recovery/idempotency, display ownership and unchanged wizard goldens. Exactly2matches and fixture cleanup verified. The remaining original plan/point6 and actual rematch robustness08 remain open; no physical-device certification.

## Profile catalog and enrichment ownership (2026-11-18)

`useProfileCatalog` owns the complete personal/admin catalog traversal, state and request cancellation. It returns a scoped successful load result; the route only schedules enrichment against that result. `useProfileMetadataEnrichment` owns the color/bracket and CMC batch jobs, pause/inflight refs, collection mirror and CMC progress. The route provides its original color resolver explicitly: the similarly named library helper has different image fallbacks/delays and is not silently substituted. `lib/types/profile-deck` holds the existing deck/import-preview view contracts. SDK calls live in the two named containers, not presentation. Both owners join the runtime graph gate.

This commit is mechanical: both enrichment callback bodies match the previous page AST text after line-ending normalization; request routes, batch limits, delay values, write order and updates remain unchanged. Catalog assertion is one compatible typed boundary, with no added runtime validation or unknown-cast chain. Adding stable setter/resolver hook dependencies changes no execution identity. Existing lifecycle defects (background work after navigation/context changes, pause races and loading state across scopes) are follow-up behavior changes, not certified fixed by this extraction.

Before characterization on application1e6839a0 passed desktop/mobile4/4:251decks across250+1pages, failed final page hides the partial collection, retry resets cursor/revision and finds deck251; missing CMC causes one intercepted lookup/PATCH without dropping the collection. Backend Auth is real and disposable; catalog/metadata/write boundaries are mocked, no synthetic deck write reaches Dev. Fixture cleanup verified.

| Target/owner | Nonempty lines | useState | useEffect |
|---|---:|---:|---:|
| Profile before (be401b64) |3480|63|11|
| Profile after extraction |3274|58|9|
| Catalog controller |49|4|1|
| Metadata enrichment controller |165|1|2|

AST artifact: `artifacts/dev26/architecture-profile-catalog.json`. Other targets remain table3801,web game1193,native game2227nonempty lines; all four still exceed800. No completion claim for point6. Web quality721+3skip/67script, ratchet139 unchanged; typecheck/lint/runtime boundaries PASS. Clean build and after-browser characterization remain pending at this checkpoint. Native source/behavior unchanged in this web-only extraction.

Catalog/enrichment327424f9 verified: full web quality721+3skip/67script, ratchet139 PASS; clean56route build and3.18/18MiB budget PASS. After-browser desktop/mobile8/8 passed complete251deck traversal/tailfailure/retry, one CMClookup/PATCH, profile complete metrics/draws and real archive/restore with Axe. Fixture cleanup verified. No native source/SQL/device/distribution changes; lifecycle behavior fixes are a separate next tranche.

## Profile catalog/enrichment lifecycle fixes (2026-11-18)

Three failures were reproduced independently against327424f9 with real mounted pages: retrying a failed final catalog page did not show loading; a pending CMC request stayed alive after SPA navigation; a deferred6000ms metadata idle callback remained queued after leaving. Failed-run fixture cleanup passed. Logs: `profile-lifecycle-red-e2e.log`, `profile-cmc-red-e2e.log`, `profile-idle-red-e2e.log` under artifacts/dev26. These are distinct behavior fixes following the verified mechanical extraction.

Catalog status/decks/completeness are one state tied to an account/admin context token. Committed context owners reject old refresh calls and local updates, including returning to the same account after an intervening context. Layout cleanup aborts the owned traversal before the next screen is interactive. A failed/initial retry shows loading; refreshing an already complete catalog preserves the existing UI while awaiting a full replacement. Admin verification masks prior scope until resolved.

Enrichment now owns the idle scheduler as well as its two job leases. Cleanup on navigation, pause and scope changes cancels queued callbacks and job controllers; replacing a catalog load propagates its abort signal through the chain. Each HTTP request includes body parsing inside a15s deadline; SDK writes use the same deadline/abort owner. The original color resolver accepts the same signal. Guards before and after writes prevent stale acknowledgements from modifying a new collection. An already accepted server write cannot be rolled back by abort.

`delay` accepts optional AbortSignal and clears its timer/listener; `runWhenIdle` returns an idempotent disposer for native idle scheduling and fallback timers, and ignores callbacks delivered after cancellation. Existing call sites which ignore the return value retain their behavior. Unit regressions cover cancellation, completed cleanup and server/nonbrowser use; all prior coverage floors stay unchanged. Background failures terminate optional enrichment rather than producing an unhandled rejection; no new business feature or package is introduced.

AST snapshot `architecture-profile-lifecycle.json`: profile3270nonempty lines/58states/9effects; catalog64lines/1state/1layout effect; enrichment225lines/1state/2layout effects. The four entrypoints still exceed800. Account/admin transition tests for the complete profile and its other commands remain open; this slice does not certify the whole page lifecycle or point6. Typecheck/lint/grafo and full web quality pass; clean build and actual green browser runs are still required at this checkpoint.

Lifecycle47deccc2 verified: web quality725+3skip/67script, ratchet139 unchanged; clean56route build and3.19/18MiB budget PASS. Browserdesktop/mobile12/12PASS with the three reproduced failures now green. Pending CMC and queued idle cases each mount/unmount twice, observe cancellation/no accumulated queue and zero late PATCH; complete251deck traversal/retry, successful CMC enrichment, aggregate metrics and archive/restore+Axe remain green. Fixture cleanup verified. Account/admin transitions beyond this catalog owner and all other profile commands still require their own ownership/tests. No native/SQL/device/distribution changes.

## Profile account credentials extraction (2026-11-18)

`useProfileAccountCredentials` owns seven existing draft/busy/panel states, nickname orchestration and password commands. It is called unconditionally by the route, preserving the old root component lifetime even while AppLoader temporarily replaces the rendered UI. `ProfileAccountPanel` is presentation only, with typed controls and a child slot for existing Archidekt settings. The parent profile directory still persists display names and owns admin nickname edits; Auth SDK calls stay in the named hook owner. No credentials or account state are moved to a singleton. Input styling remains a scoped feature export. Password validation imports the same canonical isStrongPassword implementation previously reached through a UI wrapper.

AST bodies of save-own-nickname, change-password and panel-toggle match the prior page after newline normalization. Header/form markup, labels/classes, validation, reauth/update order and feedback are preserved. Existing credential cancellation/double-submit/account-transition risks are not solved by this mechanical commit; the global Auth reauthentication step needs a separate review before complete lifecycle certification.

Before browser characterization on47deccc2 passed desktop/mobile2/2: nickname failure preserves whitespace draft, successful trim updates header/closes editor; weak/mismatching passwords block submission; failed current-password verification preserves all fields and sends no Auth user update. Auth and profile writes are intercepted, so no password or real nickname changes/email are sent. Disposable fixture cleanup verified.

| Owner | Nonempty lines | State | Effects |
|---|---:|---:|---:|
| Profile before |3270|58|9|
| Profile after |3000|51|8|
| Credential hook |115|7|1|
| Account presentation |206|0|0|

Snapshot: `artifacts/dev26/architecture-profile-account.json`. Runtime gates inventory the hook as a container and the panel as presentation; type-only contracts do not load the Auth SDK into the panel. Full web quality725+3skip/67script and ratchet139 unchanged PASS; typecheck/lint/graphs PASS. Clean build and after-browser checks remain pending. This continues point6 but all four mandatory entrypoints remain above800lines; no native/SQL/device/release change.

Account extractionacca60ab verified: full web quality725+3skip/67script and ratchet139 PASS; clean56route build/3.19MiB budget PASS. Browserdesktop/mobile16/16 passed nickname/password characterization, catalog and job lifecycle, complete aggregates, archive/restore+Axe and existing Archidekt/notification flow. Fixture cleanup verified; all credential/profile write boundaries in the new test are intercepted, with no real password update. Source lifetime and three command bodies are preserved.

Auth follow-up evidence: installed SDK supports current_password, but the official password-security guide says server enforcement is configuration-dependent. Dev-only read-only Docker metadata shows supabase/gotrue:v2.189.0 and no GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD setting. Do not treat sending that property as verification without checking deployed enforcement. Existing signInWithPassword stores a session and broadcasts SIGNED_IN in the installed SDK, so a lifecycle fix must address that side effect, preserve the current-password check and avoid changing global Auth configuration/installed-client compatibility. No auth configuration changed. Sources: https://supabase.com/docs/guides/auth/password-security.md and installed @supabase/auth-js/src/GoTrueClient.ts, lib/types.ts. Current changelog checked: https://supabase.com/changelog.md.

## Password command isolation and lifecycle (2026-11-18)

Two browser failures were reproduced againstacca60ab: leaving the profile did not abort password verification; successful verification replaced the browser session and the update used that new session. Logs: `profile-password-abort-red-e2e.log` and `profile-password-session-red-e2e.log`. Password writes in these cases are intercepted, so fixture passwords are not changed by browser characterization.

`useProfilePasswordChange` owns a draft/status object and an account/email/provider/panel lease. Closing/navigating/changing scope aborts work, masks and clears another account's secrets, prevents old completions/toasts and synchronous duplicate commands. Fields are disabled while saving; ordinary failure retains drafts. The route still invokes the account hook unconditionally. Nickname directory commands are a separate remaining lifecycle boundary.

`lib/profile-password` uses the installed Supabase SDK in a private nonpersistent client with a distinct storage key, no URL detection/auto-refresh or shared browser Auth broadcasts. It verifies the current password and account ID, restores the original session into private memory, verifies its user, and updates under that original JWT. The application session is never replaced by verification. Explicit local logout targets only the temporary verification JWT; SDK dispose releases background resources. A15s deadline/abort guards the operation; a near-expiry original session is rejected instead of privately rotating its refresh token. Cleanup has a separate2s bound and a promise handle; it cannot turn an acknowledged password update into a timeout. Missing verification sessions after the update are recognized through the SDK's AuthSessionMissingError predicate, not treated as a false warning.

The current_password attribute alone is insufficient with deployed enforcement disabled; verification remains explicit. No global Auth configuration, OTP/email flow or dependency was added. On servers requiring nonce reauthentication for old sessions, policy errors remain enforced; deployment must review that configuration rather than silently weaken it. Current Dev v2.189 has recent-reauth unset/defaultfalse. Official deployed-version sources: https://raw.githubusercontent.com/supabase/auth/v2.189.0/internal/api/user.go and https://raw.githubusercontent.com/supabase/auth/v2.189.0/internal/models/user.go show UpdatePassword preserving the caller's session and removing the others.

Thirteen real-SDK/offline-transport unit cases cover target identity, original JWT, wrong credentials, failed restore/update, cancellation with a late response, near expiry, stalled transport, original-token cleanup protection and acknowledged update before slow cleanup. All existing floors remain unchanged; the new service floor records96.15lines/90.9branches/87.5functions/94.91statements. Web quality738+3skip/67script passed before adding this floor.

Live QA command: `E2E_ENV_ROOT=<primary-env-root> node scripts/run-dev26-password-qa.mjs`. It hard-checks Dev/SSH/GoTrue image and password-notification defaults, records its owned fixture before creation, then changes only that disposable user's password. Actual Dev results: original client token unchanged, original refresh still valid, old password rejected/new accepted, READONLY auth.sessions contains only the original session; fixture Auth/profile cleanup verified. No mail is sent and no server settings change. Report and recovery manifest under artifacts/dev26/profile-password-live-*.json contain no credentials or JWTs. Final clean build and green browser runs remain pending at this checkpoint.

Passwordadb11c35 verified: full web quality738+3skip/67script; all139prior ratchets retained, new reviewed service floor brings140PASS. Clean56route build and3.19/18MiB budget PASS. Browserdesktop/mobile20/20PASS: both red regressions now green, pending verification aborts on leaving, successful verification keeps original-cookie fingerprint and uses the original JWT, only temporary JWT is logged out, authenticated reload succeeds; prior account/catalog/metadata/archive/Archidekt checks remain green. Fixture cleanup verified.

The tracked live Auth QA script was rerun on the same commit: actual disposable password change, old credential rejected/new accepted, original client JWT unchanged and refresh valid, READONLY auth.sessions only original remaining; Auth/profile fixture cleanup and pendingfalse manifest verified. No warning: deployed Auth reports an already revoked session as AuthSessionMissingError400, handled by the SDK predicate and a regression. Notifications, require-current-password and recent-reauth are unset/defaultfalse on Dev v2.189; no mail/configuration/production changes. No native/device certification. Remaining profile directory/nickname/import/editor and other mandatory target owners are still open, as is release dependency security.


## Profile nickname directory extraction (2026-11-18)

`useProfileDirectory` owns directory loading, nickname drafts, busy IDs and display-name persistence; `ProfileNicknameDirectory` owns presentation through a narrowed typed contract. `ProfileDirectoryEntry` is the unchanged shared feature type. The route still triggers loading and supplies its own-profile save callback. Query columns/order, RLS, trimming, error/retry feedback and markup are preserved. Load and save function AST bodies match the previous route after newline normalization. This mechanical tranche does not yet fix late replies, account/role transitions or duplicate commands.

| Owner | Nonempty lines | useState | useEffect |
|---|---:|---:|---:|
| Profile before |3000|51|8|
| Profile after |2902|48|8|
| Directory controller |66|3|0|
| Nickname presentation |60|0|0|

Before characterization passed desktop/mobile2/2 onadb11c35: correct target, failed save preserving draft, successful retry/trim, own profile unchanged. Admin role is mocked only in UI and profile writes intercepted; no actual permission grant or nickname mutation. Dev disposable fixture cleanup verified. Post-extraction quality/build/browser checks remain pending; all four mandatory entrypoints still exceed the800-line target.

Directoryb3135cfe verified: web quality738+3skip/67script, ratchet140 unchanged; clean56route build/3.19MiB budget; browserdesktop/mobile22/22 with fixture cleanup PASS. Admin nickname targeting/error/retry joins all previous profile/catalog/metadata/password/Archidekt/archive checks. No permission grant, real profile write, schema/native/device/deployment changes. Lifecycle follow-up remains open; existing Next/httpxy11close warning remains visible.


## Directory and nickname lifecycle (2026-11-18)

Before fixes on b3135cfe, browser tests reproduce a pending nickname PATCH surviving navigation and pending directory GETs surviving navigation. The directory test observes all outstanding requests: the previous parent can trigger several loads, so one-request assumptions were removed before recording the actual cancellation regression. Fixture cleanup passed for each run.

The directory controller uses an account/admin-resolution/role context token, layout cleanup, cancellation and15s deadlines. A new load supersedes the previous load. Scoped setters reject stale callbacks, and another context sees empty data immediately. Per-profile synchronous guards prevent duplicate writes while allowing distinct admin targets. A write aborts any older read, and refreshes during writes are skipped; no old read can overwrite an acknowledged nickname. Same-context dirty admin drafts survive refresh. Display-name trimming, query/order and backend RLS are unchanged. Server writes accepted before cancellation cannot be rolled back by AbortSignal.

Account nickname drafts/panel/busy state are keyed by account. A separate request lease aborts on navigation, account change or panel switching; late completion cannot close the newly opened password editor. Current-account errors preserve drafts, and directory refreshes preserve dirty nickname edits. Inputs are disabled while their write is pending. Password verification remains in its existing isolated owner. Actual account/role transition browser certification and remaining profile import/editor lifecycle are still pending.

The third regression on b3135cfe reproduces a nickname PATCH surviving a switch to the password panel (profile-nickname-panel-red-e2e.log). Directory controller114nonempty lines/1state/1layout; account owner77/1state/1effect/1layout; route2902/48state/8effect. Prebuild quality738+3skip/67script and coverage ratchet140 PASS. Green browser/build evidence pending.

Directory lifecycle4a26dfd6 verified: quality738+3skip/67script and ratchet140 PASS; clean56route build/3.19MiB budget PASS; browserdesktop/mobile28/28 PASS with verified Dev fixture cleanup. All three reproduced cancellation regressions are green; load/save run across two mounts and panel switching preserves nickname drafts/password editor. Prior account/Auth/catalog/metadata/Archidekt/archive checks remain green. No native/schema/device/deployment changes. Real account/role transition certification remains pending; this does not close point6 or the release security gate.


## Profile commander metadata extraction (2026-11-18)

`lib/profile-commander.ts` owns browser public-card search, authenticated server fallback, art cache/storage/in-flight requests, imported preview image repair, and existing commander/color preparation wrappers. It holds no private account/draft data. Eighteen function bodies are AST-identical to the previous route after newline normalization. Storage key v7,30-day public art TTL, query filters, result cap20, mappings,120ms legacy inter-item delays and fallback order remain unchanged; centralized Scryfall transport still owns the effective request rate. This mechanical extraction does not certify unbounded outer caches or fix editor/import request lifetimes. Those remain separate follow-ups.

Profile route2902→2570nonempty lines; new owner352nonempty lines, below500. No state or effect moves in this tranche. Browser before characterization on4a26dfd6 passed desktop/mobile2/2: manual commander search, selection, printing preview, source query and zero deck writes; fixture cleanup verified. A test's initial button selector omitted its accessible description; the selector was corrected without changing application UI. Thirteen adapter tests cover query/mapping/cap/cache isolation by mode, abort/fallback, DFC face selection, art request coalescing/retry/storage failures/TTL, imported preview repair, retained unknown metadata, selected images and partner colors. Full quality/build/browser-after remain pending.

Prebuild commander quality751+3skip/67script PASS; existing140coverage floors unchanged. Adapter coverage93.42lines/72.72branches/100functions/86.31statements becomes an additional reviewed floor141. The route remains48states/8effects; the352-line browser adapter adds none.

Commander94b6f6d5 verified: quality751+3skip/67script and ratchet141 PASS with all140previous floors retained; clean56route build and3.19/18MiB budget PASS. Browserdesktop/mobile30/30 after extraction PASS, including manual search/printing preview and all existing nickname/Auth/catalog/metadata/Archidekt/archive cases. Fixture cleanup verified; commander preview performs no deck writes. No new dependency/feature, schema/native/device/deployment changes. Remaining boundaries include search/manual/import/editor ownership and cancellation on close/short query/unmount/account transition, selected target ownership and bounded outer public caches. All four mandatory entrypoints still exceed800; the overall plan and release security gate remain open.


## Profile commander search owner extraction (2026-11-18)

`useProfileCommanderSearch` owns six query/results/busy states, two request refs, two search callbacks and three effects previously owned by the route. The thirteen statements are copied unchanged; search timing400ms, partner filtering, query/result clearing and request behavior are preserved. Selection, art loading, imported previews and persistence remain outside this owner. The extracted hook intentionally preserves existing incomplete cancellation on closing, short queries and navigation, to fix in a distinct commit with reproduced browser regressions. The hook is109nonempty lines; profile2484/42states/5effects (previous2570/48/8). Before browser evidence on94b6f6d5:30/30 including manual search/printing, prior profile and cancellation regressions. Full quality/build/after browser pending.

Search ownera145f560 verified: quality751+3skip/67script/ratchet141, clean56route build/3.19MiB budget, browserdesktop/mobile30/30 after extraction with verified fixture cleanup PASS. Existing behavior remains unchanged. Proceed to explicit scoped cancellation fixes rather than considering point6 complete.


## Scoped commander search cancellation (2026-11-18)

Two valid browser regressions were reproduced against a145f560: clearing the primary query and navigating back each left the public Scryfall request pending (expected one cancellation, observed zero). The initial close test pressed Escape, but this existing modal has no onClose handler: it did not actually close, so that run is not valid close-regression evidence. The test now follows Back→Cancel and asserts the dialog is absent before evaluating cancellation. Disposable Dev fixture cleanup passed for every run.

The search owner now composes two independent channels. Each owns one state object, context lease, debounce timer and request controller. Context includes account/admin scope, manual-modal availability and partner constraints. A context change masks previous values immediately and layout cleanup aborts owned requests. Input edits abort immediately, including short/empty queries; effect cleanup cancels the400ms timer and request. The15s request deadline includes authenticated fallback/body parsing. Guarded results/busy updates and feedback cannot escape an old lease, including A→B→A. Primary/partner queries remain independent and primary-name exclusion is preserved. Parent reset no longer writes a channel's busy flag.

This fixes search ownership only. Selected commanders, target account, art/import/editor drafts and real account/role transition certification remain open. Metadata outer cache behavior is unchanged. Quality751+3skip/67script/ratchet141 PASS; final build and green browser evidence pending.

Search lifecycle767f7a05 verified: quality751+3skip/67script/ratchet141; clean56route build/3.19MiB budget; final browserdesktop/mobile36/36 PASS and verified fixture cleanup. Two valid red regressions (clear/back) are green; real closing follows Back→Cancel and asserts dialog absence. All three cancellation cases repeat two openings with no late results. Partner selection excludes primary and preserves composite name. Test-only correction after build replaces unsupported Escape assumptions; application source remains767. Search hook95nonempty lines, one state/layout/effect per independent channel; route2484/42states/5effects. Remaining import/art/editor/account-transition and security work is explicitly open.


## Separate URL and public Archidekt import preview owners (2026-11-18)

The route delegates URL draft/preview/commander/art state to `useProfileUrlImport` (six states,74nonempty lines) and public Archidekt username/catalog/selection state to `useProfileArchidektImport` (five states,64lines). `useProfileCommanderArts` (22lines, no state/effects) retains browser-first art lookup and authenticated fallback for URL/manual/editor callers. Four command/loader bodies match the previous route AST after newline normalization. Persistence, overwrite confirmation and target-account selection remain in the route; no textual decklist import or other feature is added.

Profile2484→2388nonempty lines,42→31states,5effects unchanged. Before browser characterization on767f7a05 passed URL2/2 and public username2/2 desktop/mobile: failed draft retained, retry to preview, no deck writes, unusable source excluded, All/None selection and save availability retained. Fixtures cleaned. Existing query/order, API payloads, image normalization, fallback and parent reset behavior remain unchanged. The extraction intentionally does not yet solve import/art cancellation, single-flight or account transition ownership. Full quality751+3skip/67script/ratchet141 PASS; clean build/browser-after pending.

Import owners7664b224 verified: quality751+3skip/67script/ratchet141, clean56route build/3.20MiB budget, browserdesktop/mobile40/40 after extraction PASS with verified fixture cleanup. URL and public username error/draft/retry/selection/zero-write contracts join prior profile/Auth/search/catalog/metadata/archive checks. No native/schema/device/deployment changes. Next lifecycle design: account/role context and enabled-operation leases; synchronous single-flight per import and replaceable art job; propagate cancellation through preview image repair/art fallback; delegate shared HTTP deduplication to the already-tested Scryfall transport; normalize public catalog previews with existing max3-worker utility rather than enqueueing an unbounded Promise.all. Persistence/overwrite and selected-target/editor state remain outside this preview tranche.


## Import preview and art command lifecycle (2026-11-18)

Three browser failures were reproduced on7664b224 with verified Dev fixture cleanup: pending URL import and pending public username import both survive the actual Back→Cancel flow, and an older primary art request survives selecting another commander. Each observes a started request before expecting cancellation; no production API/deck write is used.

`useProfileImportScope` owns account/role context and a separate enabled-modal epoch. Its job names are restricted to import/art: synchronous single-flight import and replaceable art work, bounded generation markers, layout cleanup and scoped callbacks. Completion marks a job no longer pending without discarding its generation before React applies an acknowledged update. Replacement/cancellation/account/modal changes invalidate that generation. Drafts remain account-scoped while results and busy jobs are tagged with modal epoch, preventing late replies from appearing in another opening even during batched commits.

URL/username controllers each own one state object. Typed reset/select commands replace exposed raw preview/art setters. Inputs are disabled while importing; ordinary failure preserves the input. URL import and art transport have15s deadlines including JSON/normalization/fallback. Public catalog HTTP has15s deadline; image repair then runs at most three workers with per-request transport deadlines, preserving order and publishing only a complete catalog. Closing or changing scope aborts active work and queued repairs stop before issuing new calls. Persistence, overwrite confirmation and selected-target/manual/editor state remain outside this preview certification.

Metadata helpers now accept cancellation through exact/fuzzy lookups, image repair and art search. The redundant outer art in-flight promise map was removed: the existing shared Scryfall transport already deduplicates HTTP with independent subscriber cancellation and fresh Response objects. The adapter unit test now verifies independent response mapping rather than incidental array identity; actual HTTP coalescing/cancellation remains covered by transport tests. Public art cache key/TTL/mapping and fallback order are retained; outer cache size/error policies remain open. Four new adapter regressions cover forwarded abort, cancelled cache hits/image repair and bounded/ordered/cancelled bulk work;17adapter tests PASS. Browser fixtures and import cases moved unchanged into a dedicated feature suite, registered in the Dev runner. Final quality/build/browser pending.

Import lifecycle prebuild quality756+3skip/67script/ratchet141 PASS with every prior floor retained. The initial coverage failure exposed an untested two-partner image-repair resolver; the added regression exercises both lookups under the caller signal and source immutability. Adapter18tests now pass with95.23lines/100functions/87.63statements/73.68branches. No floor was lowered. Client cancellation does not roll back server proxy work already accepted; server-side upstream cancellation is outside this preview proof. Source sizes: app/profile/page.tsx=2374, hooks/use-profile-url-import.ts=92, hooks/use-profile-archidekt-import.ts=90, hooks/use-profile-import-scope.ts=58, hooks/use-profile-commander-arts.ts=24, lib/profile-commander.ts=348. Green build/browser still pending.

Import lifecycle490daf83 verified: quality756+3skip/67script/ratchet141 with unchanged floors; clean56route build/3.20MiB budget; final browserdesktop/mobile50/50 PASS and verified fixture cleanup. All three valid red regressions are green. URL and public username imports cancel on actual close/back across two openings, busy inputs are disabled, no late previews appear. Art replacement cancels the previous request and explicit printing selection survives its late release. The first green test incorrectly expected automatic image replacement; the canonical resolver preserves the current image, so only the test was corrected to assert preservation and explicitly choose the new printing. Application source remains490. Prior account/Auth/search/catalog/metadata/Archidekt/archive+Axe checks stay green. No new dependency, feature, schema/native/device/deployment changes. Point6/overall plan, real account/role transitions, persistence/editor and outer cache/security gates remain open.


## Saved-deck commander editor extraction (2026-11-18)

`useProfileCommanderEditor` owns six saved-deck editor states and the existing load-art/open-editor/save-presentation commands. Catalog changes still use the scoped setter supplied by the route. Nine statements are moved without changing command bodies, CMC resolution, color merge, PATCH targeting, feedback or modal reset behavior. The140-line controller has no effects; profile2374→2265nonempty lines,31→25states,5effects unchanged. Selection, current-art preservation and immediate art persistence retain their existing behavior.

Before characterization on490daf83 passed desktop/mobile2/2: first deck PATCH fails, editor/art choice stays available, retry targets the same owned fixture ID and metadata payload, success closes the editor and updates the card image. All deck writes are intercepted. The test initially mocked the batch CMC API, whereas this editor uses direct browser Scryfall named lookup; the fixture was corrected to provide the positive CMC at that real boundary. Fixture cleanup verified. Full quality/build/after browser pending. Cancellation, duplicate writes, modal/account/editor transition scope and optional CMC failure handling remain separate follow-ups.
