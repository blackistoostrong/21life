# Registro dei merge falliti

## 2026-11-25 — PR262 secondo tentativo REST
- PUT merge con SHA atteso f84b3297 restituisce HTTP502; orchestrazione interrotta immediatamente. Readback REST senza cache: OPEN, merged=false; ref remoto Dev ancora d24a578f. Tutti i check f84b3297 verdi prima della richiesta. Nessun merge attestato, nessun build/deploy dipendente.
- GraphQL PR267 mostrava il vecchio head62f903fc, mentre REST no-cache e ref remoto concordano su301cc8ff: usare REST e ref per distinguere cache da push perso. Nessun force-push/reopen o bypass. Sospesi ulteriori tentativi identici di merge finché manca evidenza nuova sul servizio.
- Prevenzione: dopo 5xx verificare separatamente merged e ref; merge_commit_sha da solo può indicare il merge di prova, non un merge avvenuto.

Prima di ogni nuova build leggere questo registro e la
[checklist pre-build](RELEASE_PREBUILD_CHECKLIST.md). A ogni merge fallito o con
esito incerto aggiungere una voce prima di proseguire. Distinguere fatti verificati,
cause ancora sconosciute e conseguenze. Non registrare token o altri segreti.
L'avanzamento dei task resta in `PROJECT_CHECKLIST.md`.

## 2026-10-05, 16:22 Europe/Rome — promozione 9.0.5, PR #155

- **Operazione:** `gh pr merge 155 --merge`, destinazione `main`, sorgente Dev
  `caacfd96700351699a0f2c669eb3872312e00803`.
- **Errore verificato:** GitHub GraphQL ha risposto «Something went wrong while
  executing your query». ID diagnostico `7CA6:206F5B:2D80574:2D33796:6AC3B2A1`.
  La causa interna di GitHub non è accertata. Non era un conflitto confermato:
  la PR era ancora OPEN/CLEAN e il merge non era avvenuto.
- **Errore nel nostro flusso:** la sequenza PowerShell non interrompeva i comandi
  successivi al codice di uscita nonzero di `gh`. Anche il confronto degli alberi
  fallito non fermava la sequenza. Sono stati eseguiti checkout, tag e deploy
  senza verificare il successo dei prerequisiti.
- **Conseguenze:** `v9.0.5` puntava temporaneamente al vecchio main `1c319233`,
  versione 9.0.4. Il [run 37324188214](https://github.com/marco201091-glitch/PhyrexianArena/actions/runs/37324188214)
  è fallito in «Resolve and validate release version» con «Tag/input version
  9.0.5 does not match expo/app.json version 9.0.4». Nessuna release 9.0.5 era
  pubblicata da quel run. È stato accodato anche un deploy del vecchio main.
- **Recupero verificato:** stato PR e SHA riletti; tag errato rimosso dopo verifica
  dell'assenza della release; merge REST con SHA atteso riuscito. La
  [PR #155](https://github.com/marco201091-glitch/PhyrexianArena/pull/155)
  risulta MERGED dal 2026-10-05 alle 16:23:22 Europe/Rome, commit
  `c90f5c818dc9d0304176c76df8663a46f788d09d`. Albero identico a Dev testato,
  versioni 9.0.5/90005 e correzione Archidekt verificate. Tag corretto e tre build
  avviati da quel commit. Questo registro non attesta il completamento dei build.
- **Prevenzione obbligatoria:** stop su ogni errore nativo; verifica del merge
  remoto prima del checkout; verifica di commit, contenuto, versione e tag prima
  di qualsiasi compilazione, push del tag o deploy.

## Modello per i prossimi fallimenti

## 2026-11-25 — Risposte GitHub incoerenti durante integrazione mobile

- Push logout62f903fc→6ed05bb6: primo tentativo Internal Server Error, nessun comando dipendente eseguito; lettura remota confermava62f903fc. Secondo push riuscito, ls-remote conferma6ed05bb6, ma API PR267 continua a riportare62f903fc/check precedenti. Nessuna assunzione di gate verdi sul nuovo SHA e nessun APK/deploy da questo stato.
- Merge PR262 con headf84b3297/check tutti verdi: gh restituisce502BadGateway prima dei comandi dipendenti, pertanto esito remoto inizialmente incerto. Verificare state+mergeCommit+refDev prima di qualsiasi checkout/build riferito al merge; non ritentare alla cieca.
- Prevenzione: dopo errore5xx confrontare Git ref reale e metadati PR, preservare log e verificare l'esito prima delle azioni dipendenti. Il ref locale del lavoro sync rimane f84b3297 con modifiche isolate, nessuna build di rilascio basata su merge presunto.

## 2026-11-25 — SDK57 nel ramo journal PR262

- Merge origin/maintenance/dev26-expo-sdk-patches9dfe3807 in fix/dev26-native-outbox-preservation1047baef: exit1 soltanto PROJECT_CHECKLIST, append concorrenti. PR262 OPEN/head1047baef verificati; nessun build/merge remoto dipendente avviato.
- Recupero: preservate entrambe le sezioni del registro unico; sorgenti SDK e journal non in conflitto. Verificare zero unmerged/marker e nuovi check prima dell'integrazione Dev.
- Prevenzione: confrontare le aggiunte alla checklist quando si incorporano dipendenze tra PR; non sostituire il file intero con ours/theirs.

## 2026-11-20 — PR241 integrazione Dev bloccata dal toolchain dei test condivisi

- PM richiede merge Dev e APK9.3.0 Dev. PR241 OPEN/MERGEABLE ma BLOCKED sud83e81a3; nessun tentativo di merge/buildAPK effettuato.
- JobExpo136363506640 delrun44758180823 fallisce al typecheck: test condivisi importati da `../tests/lib` non risolvono `vitest`; il job installa solo `expo/node_modules`, mentre il modulo chiamante risolve il pacchetto dal repository root. Le installazioni locali complete spiegano il PASS locale, senza invalidare il ROSSO CI.
- Recupero: installare con `npm ci` anche il toolchain root nel jobExpo, usando i lock esistenti; nessuna esclusione di test, modifica di soglie o dipendenza nuova. Richiedere check verdi prima del merge, verificare SHA remoto finale prima di compilare APK.
- Prevenzione: ogni job che consuma test condivisi esterni alla propria directory installa entrambe le dipendenze dichiarate. Nessun bypass delle protezioni per compilare in anticipo.

- Data/ora Europe/Rome, PR, destinazione e SHA sorgente atteso:
- Comando, codice di uscita, errore/API o link al log:
- Stato remoto osservato dopo l'errore:
- Causa verificata / causa sconosciuta:
- Conseguenze e operazioni realmente eseguite:
- Correzione applicata e prova del recupero:
- Controllo preventivo aggiunto alla checklist:


## 2026-10-08 — ritorno hotfix main nel candidato Dev
- Merge locale origin/main c3d5ae34 nella feature chore/21life-domain b632fff: git merge exit1, conflitto soltanto PROJECT_CHECKLIST.md per note aggiunte alla stessa posizione.
- Verifica remota: PR175 MERGED, commit c3d5ae34; nessun build/tag/deploy dipendente avviato dopo il conflitto.
- Risoluzione revisionata: mantenere tutte le note rebranding e il record incidente comune; nessuna differenza applicativa rispetto ai due candidati testati. Conservare ancestry main, senza subset di schema/test.
- Prevenzione: verificare i conflitti checklist su back-merge e fermare build/deploy finche markers e file unmerged non sono assenti.

## 2026-10-12 — PR #193, controllo merge web bloccato da Archidekt
- Sorgente 7fab6cd978bbb33de957ba5a3d9c225fff68b9af, destinazione main. Nessun tentativo di merge/deploy effettuato; PR OPEN/BLOCKED.
- Quality run 38225800252: 342 test passati, 2 falliti in deck-importers-server.test.ts per HTTP403 Archidekt dal runner GitHub; lint/typecheck, Expo e CodeQL passati.
- Causa verificata: due unit test dipendevano da deck pubblici e immagini live; codice importazione invariato rispetto a main. Nessun problema UI individuato.
- Recupero: risposte pubbliche ridotte Archidekt/Scryfall salvate come fixture, fetch intercettato solo nei test, URL inattesi rifiutati e globals ripristinati. I due test passano senza rete; nuovo controllo CI richiesto prima del merge.
- Prevenzione: controllare che unit test importazione usino fixture, non servizi esterni; nessun bypass protezioni o retry deploy.
- Aggiornamento run38226544550: tutti344test verdi, soglia coverage per-file importatore non raggiunta dalle risposte ridotte (functions60.29<61.76, statements48.78<49.59). Aggiunti casi pertinenti top-level commander, bracket HTML frammentato e HTTP403; 346test verdi e ratchet103file passato, soglie invariate. Nessun merge/deploy effettuato.

## 2026-10-12 — PR193 desktop counter click regression
- Run38227127337: quality/build passed,25E2Epassed/4skip,3desktop life-feedback failures. PR not merged; no deployment launched.
- Root cause reproduced locally: desktop transition-property override removed transform/translate/scale animation. Existing active translate-y-px jumps a centered counter button away from pointer before mouseup; its rotated wrapper intercepts clicks. Without override the same real click changes40to41; with override timeout/life40.
- Recovery: remove only transition-property override, retaining Button default transition-all; phone and gameplay logic unchanged. Verify existing desktop/mobile life-feedback tests on fresh build and remote required checks before merge.
- Prevention: desktop restyle changes to shared Button must run actual quick-game life-feedback E2E, including normal/system/app reduced motion; setup-only smoke is insufficient.

## 2026-11-16 — PR246 conflitto documentale dopo PR248
- Stato remoto OPEN/DIRTY verificato prima del recupero. Merge locale origin/Dev30ad2a90 fallito esclusivamente su .agents/PROJECT_CHECKLIST.md: append concorrenti dei registri offline e rename.
- Risoluzione: preservate entrambe le sezioni; nessuna scelta ours/theirs sull'intero file. Verifica assenza file unmerged/marker, quindi nuova CI obbligatoria prima del merge Dev. Nessun deploy/tag/APK/IPA.
- Prevenzione: controllare base e HEAD dopo aggiornamenti concorrenti della checklist; registrare la causa prima di riprendere compilazioni dipendenti.

## 2026-11-16 — Integrazione fix odierni nel candidato 9.3.0
- Merge locale di origin/fix/dev-offline-recovery65843c20 nel branch improvement/dev26-foundation3e2cecb5: conflitti su versioni9.3.0 contro hotfix9.2.1 e relativi lockfile/User-Agent/README. PR241 e246 remote OPEN verificati; nessuna integrazione remota o deploy.
- Recupero: preservare versione candidata9.3.0/90300 e regole/toolchain del foundation, incorporare correzioni9.2.1 e patchSDK; rigenerare lock coerenti e verificare marker/file unmerged prima di quality. Nessun cambio DB o buildAPK/IPA.
- Prevenzione: distinguere versione candidata dalle versioni dei rami hotfix durante il riallineamento; validare insieme manifest/lock/config nativi.


## 2026-11-16 — PR241, snapshot wizard desktop dopo riallineamento9.2.1
- CI43839202153: web rosso al solo screenshot wizard desktop; Expo/CodeQL verdi. Nessun merge o deploy tentato.
- Artifact expected/actual ispezionati: nuova barra sticky Back/Next copre le etichette inferiori nella cattura del componente a viewport corto. Fix applicativo9.2.1 preservato.
- Recupero candidato: cattura preview desktop con altezza sufficiente, golden/tolleranza invariati; ripristino viewport originale e verifica Next→scelta posti. Test locale e nuova CI necessari prima del merge.
- Prevenzione: screenshot di componenti non deve includere overlay esterni; azioni sticky vanno verificate funzionalmente alla viewport reale. Nessun aggiornamento cieco snapshot o bypass.
