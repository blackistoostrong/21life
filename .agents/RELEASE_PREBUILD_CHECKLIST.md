# Checklist obbligatoria prima di compilare o distribuire

- [ ] Se cambiano backup/restore: le query sul sorgente devono essere server-side READ ONLY; SQL di ripristino soltanto emesso nel pacchetto ed eseguito sul clone. Eseguire la regressione backup-source-readonly e verificare che la prova reale rifiuti una mutazione. Incidente Dev documentato in docs/DEV26_BACKUP_INCIDENT.md.

Leggere il [registro dei merge falliti](MERGE_FAILURES.md) prima di iniziare.
Se Next interrompe il build con `SecurityFatalError`, conservare advisory/report e correggere la versione compatibile prima di riprovare. La compilazione precedente al gate non certifica il build; il suggerimento di ripetere il comando non sostituisce la patch.
Controllare tutti i punti applicabili PRIMA di lanciare ogni build, creare o
pubblicare un tag, oppure avviare un deploy. Registrare le prove e gli SHA nella
voce del task in `PROJECT_CHECKLIST.md`. Un punto non verificato blocca il passo
che ne dipende; non equivale a un risultato positivo.

## 1. Arresto sugli errori

- [ ] In PowerShell abilitare l'arresto su errori PowerShell e comandi nativi:

  ```powershell
  $ErrorActionPreference = 'Stop'
  $PSNativeCommandUseErrorActionPreference = $true
  ```

  Se il secondo parametro non è supportato, controllare `$LASTEXITCODE`
  immediatamente dopo OGNI comando nativo e lanciare `throw` se diverso da zero.
  `$ErrorActionPreference` da solo non garantisce questo controllo.
- [ ] Nell'orchestrazione degli strumenti, controllare `exit_code` e l'esito API
  prima di qualsiasi chiamata dipendente. Una sessione ancora in esecuzione non
  prova il successo. Non continuare perché l'ultimo comando del blocco è riuscito.
- [ ] Dopo un fallimento o risposta incerta, fermare tag/build/deploy dipendenti,
  rileggere lo stato remoto e aggiornare `MERGE_FAILURES.md` prima di riprovare.

## 2. Merge realmente concluso

- [ ] Destinazione richiesta confermata: `main` per web/APK/IPA produzione;
  `fdroid-prep` per la variante F-Droid; `Dev` solo per sviluppo.
- [ ] PR corretta, SHA sorgente atteso, check obbligatori verdi e conflitti risolti.
  Non usare admin bypass o cambiare protezioni per superare un errore.
- [ ] Comando merge riuscito E API/stato remoto della PR `MERGED`, con SHA del
  merge presente. In caso di errore API non presumere né successo né fallimento.
- [ ] `git fetch origin <destinazione>` riuscito; HEAD del worktree di build
  coincide con il commit remoto finale atteso.
- [ ] Albero e modifiche funzionali attese verificati. Un solo messaggio «merge
  riuscito», un branch locale o l'assenza di conflitti non bastano.

## 3. Sorgenti e versione

- [ ] Worktree di build pulito e separato dalle modifiche locali del PM.
- [ ] Versione di package web/mobile e lockfile coerente con la release.
- [ ] `expo/app.json`, versionCode Android, buildNumber iOS e versioni visualizzate
  coerenti. Correzione richiesta effettivamente presente nei sorgenti.
- [ ] Controlli richiesti passati sui sorgenti candidati. Dopo il merge confermare
  l'uguaglianza dell'albero; nuove modifiche richiedono nuova verifica pertinente.
- [ ] Tag annotato creato solo dopo le verifiche del merge e delle versioni.
  `git rev-parse '<tag>^{}'` coincide con il commit finale richiesto; dopo il push
  verificare anche il riferimento remoto. Non spostare tag di release esistenti.

## 4. Ambiente e avvio

- [ ] Ambiente produzione confermato per ogni piattaforma: API/Supabase,
  identificativo app, profilo EAS, firma Android e branch Dokploy.
- [ ] Migrazioni necessarie revisionate, autorizzate per la destinazione,
  applicate e verificate; backup richiesto verificato prima delle modifiche.
- [ ] APK, IPA e web usano tutti lo SHA finale richiesto. Se il PM dice «tutto su
  main», non avviare in anticipo uno dei build da Dev, anche a parità di albero.
- [ ] Solo ora lanciare ogni build/deploy; annotare piattaforma, ID, versione e
  SHA restituiti. Una richiesta rifiutata non è una build avviata.
- [ ] Confermare accettazione/avvio. Monitorare fino alla conclusione soltanto
  quando richiesto dal PM. Non dichiarare «pubblicato» o «completato» a questo punto.

- [ ] Back-merge main/Dev: controllare checklist concorrenti; zero marker di conflitto e zero file unmerged prima di build/deploy.
- [ ] Unit test importazione: fixture offline per API esterne; HTTP403 esterni non giustificano bypass dei controlli merge.
- [ ] Shared web Button style changes: run desktop/mobile life-feedback E2E with normal/system/app reduced motion before promotion.

## Prossima release — mandato PM 2026-11-16

- [ ] Il candidato finale deve includere ENTRAMBI: recupero offline live game PR246 (archiviazione riuscita prima di sostituire il journal, reset flag terminali/history, sync escluso durante bootstrap) e rinomina GitHub PR247/248 a blackistoostrong/21life. Verificare il contenuto sui rami effettivamente rilasciati, inclusa la variante F-Droid se richiesta; la sola presenza delle PR non basta.
- [ ] Eseguire regressioni recupero/persistenza/sync e controlli web/Expo sul candidato finale, senza ridurre le soglie o ignorare dipendenze segnalate. Pubblicare anche il candidato statico aggiornato (link, client compatibile, CSP) registrato in docs/GITHUB_USERNAME_RENAME_2026-11-16.md; backup/candidato in artifacts/github-rename.
- [ ] Nessuna nuova APK/IPA o distribuzione prima della prossima release autorizzata: il PM ha rinviato esplicitamente le pubblicazioni. Nessun obbligo di aggiornare F-Droid9.2.1 per il solo cambio username.

- [ ] Promozione9.3.0: migrazione20261119181403_grant_arena_catalog_realtime_select verificata SOLO Dev. Prima di applicarla in produzione servono autorizzazione PM esplicita e verifica della policy membership/RLS; non estendere grant a INSERT o anon. Provare ricezione membro e rifiuto nonmembro. Nessuna applicazione produzione attestata da questo checkpoint.
- [ ] Promozione9.3.0: migrazione20261119193048_enforce_arena_guest_deck_group_scope verificata SOLO Dev. Prima della produzione: autorizzazione PM esplicita, conteggio mismatch guest/deck nullo, vincolo composto validato e unico rapporto FK guest/deck per preservare embedding PostgREST; rigetto23503 su insert/update tra gruppi e CRUD/cascade positivi. Nessun dato incoerente cancellato o riparato automaticamente; migrazione fail-closed se ne esistono.
- [ ] Promozione9.3.0: migrazioni20261120074242 e20261120080129 per save_arena_match_v1 verificate SOLO Dev. Prima della produzione servono autorizzazione PM e test invoker/RLS, binding actor, rollback header/partecipanti/notifiche e replay esatto; conflitti logici HTTP409/PT409, nessun fallback client alle scritture multiple. Migrazioni applicate immutabili; i client vanno collegati e verificati prima di chiudere la tranche. Nessuna applicazione produzione attestata.
