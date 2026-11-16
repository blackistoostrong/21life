# Recupero offline live game — correzioni Dev 2026-11-16

Base origin/Dev: 3f54cd7b (include 9.2.1). Nessun cambio versione, schema, API o produzione.

- Il passaggio dal journal A alla partita remota B attende le scritture journal già accodate e richiede il successo dell'archiviazione di mosse/finalizzazione/cancellazione A. L'errore risale al bootstrap, che mantiene la sessione locale.
- Prima di installare B vengono azzerati pendingCancel, pendingFinalization e undo/redo di A. Le operazioni archiviate conservano ID e serverRecord A.
- Sync e retry di resume non partono durante il bootstrap, evitando di processare il vecchio journal contemporaneamente alla sua archiviazione. Il sync riparte dopo il bootstrap.
- Sette regressioni di persistenza coprono archivio fallito, cancellazione A con journal B pulito, finalizzazione A, scrittura precedente ritardata o fallita, salvataggio B fallito e sostituzione senza operazioni pendenti. Usano la funzione di preparazione invocata dalla schermata e il modulo AsyncStorage simulato; non estraggono stringhe dal sorgente.

Verifica: quality Expo completa (lint, typecheck, coverage/ratchet101file, logos, knip) passata con Node24.21.0; riesecuzione finale della quality completa PASS: 364 test, ratchet101file, lint/typecheck/logos/knip. npm ls --depth=0 exit0. Dipendenze riusate dalla release9.2.1: package e lock Expo identici alla base Dev. Nessuna riduzione soglie.

Limiti: test automatici di persistenza e logica; nessun collaudo fisico o rete/Realtime autentica. Non certifica l'intero lifecycle multi-device. Prima della release resta opportuno verificare su Android/iOS: chiusura processo offline dopo mosse, riapertura/riconnessione, completamento/cancellazione con rete assente e ripresa su altro dispositivo.
