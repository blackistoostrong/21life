# DEV26 — Architettura e responsabilità

Versione candidata 9.3.0; base Dev bac40b9c. Documento di lavoro: **refactoring delle schermate ancora da eseguire**, non attestazione di completamento del punto6.

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

Le estrazioni non sono ancora effettuate. Non trasferire ogni riga in un unico useController: ogni query/subscription/journal deve avere un proprietario unico con cleanup e contratto documentati.

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
