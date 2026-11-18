# Valutazione librerie MTG — 2026-11-18

Ambito: candidato Dev9.3.0/90300, branch improvement/dev26-foundation. Verificati manifest/lockfile di web ed Expo e utilizzi reali. Analisi iniziale delle opzioni; stato di implementazione aggiornato in fondo.

| Opzione | Stato nel repository | Valutazione |
|---|---|---|
| Scryfall API | Già usata per comandanti, immagini/illustrazioni, CMC e colori; client propri in lib/scryfall.ts ed expo/lib/scryfall-search.ts, più chiamate dirette in altri moduli | Mantenere il fornitore; consolidare gli accessi e il controllo del traffico prima di cambiare client |
| scryfall-sdk / Scrython | Assenti | SDK TypeScript da provare solo dietro adapter server se riduce codice e conserva abort/cache/errori. Scrython richiede Python e non giustifica un nuovo backend |
| MTGJSON | Assente | Candidato per catalogo locale/enrichment/import batch: le statistiche delle nostre partite derivano dal DB dell'app, non dal catalogo carte. Valutare prima anche bulk Scryfall, mantenendo identità/provider coerenti |
| magicthegathering.io | Assente | Scartare nuove integrazioni: documentazione ufficiale dichiara API deprecata e funzionamento fino al1marzo2027 |
| Mana Font / Keyrune | Assenti; simboli mana già renderizzati con SVG Scryfall | Mana Font utile se servono più simboli; Keyrune quando esistono vere funzioni per espansione. Valutare subset di asset locali/accessibilità e licenze dei singoli asset; CSS/font web non è un'integrazione nativa Expo automatica |
| reactjs-mtg-card | Assente; immagini/presentazioni carte già proprie | Il manifest upstream dichiara peerReact^16.0.0; il progetto usa React19. Non scegliere questo componente come base senza un fork/test dedicato; le immagini esistenti coprono il bisogno attuale |
| Open Gathering / Forge | Assenti; motore tracker proprio condiviso in packages/domain/live-game*.ts | Motori completi di regole/simulazione non sono un sostituto diretto del contatore. Il nostro stato non contiene mano/campo/pila/priorità necessari a quelle simulazioni |
| Parser decklist | Nessun pacchetto della lista; importatori Archidekt/Moxfield propri | ESCLUSA dal PM18-11: nessuna decklist gestita, nessuna importazione testuale da implementare. Valutazione iniziale: Separare parsing testo, risoluzione nomi e adattatori HTTP; validare quantità, commander/sideboard, partner, DFC, apostrofi e nomi localizzati. Il nome mtg-parser è ambiguo: il repository verificato lheyberger/mtg-parser è Python |
| Zustand | Già presente e usato su Expo, ^5.0.15 in manifest, runtime giocatori per chiave | Riutilizzare dove appropriato. Lo store in memoria non fornisce da solo idempotenza, ACK, journal durevole o gestione conflitti |
| Redux Toolkit | Assente | Nessun beneficio dimostrato che compensi un secondo modello di stato per i flussi attuali |
| Recharts / Chart.js / Tremor | Assenti; grafici propri, react-native-svg già installato; TanStack Query già presente web/native | Prova mirata di Recharts per serie temporali/report admin web. Tremor offre componenti dashboard su React/Tailwind/Radix e Recharts, quindi selezionare componenti utili, non assumere una migrazione necessaria. Recharts/Chart.js web non diventano automaticamente componenti React Native |

## Problema concreto trovato

Il client mobile impone un intervallo minimo di90ms tra avvii richieste: teoricamente circa11,1richieste/s prima di considerare la latenza. La FAQ ufficiale Scryfall chiede traffico sotto10/s. Questo intervallo non garantisce da solo il rispetto di tale limite. Altri moduli fanno fetch diretti; il limite applicativo per utente non è un limite condiviso del fornitore. Cache/retry già esistono, ma un wrapper per singola istanza non coordina automaticamente processi/repliche. Non è stata misurata una violazione effettiva in produzione; è un rischio dimostrato dalla struttura. I limiti specifici per endpoint vanno verificati nella documentazione corrente durante l'implementazione: la pagina API principale ha risposto403 al browser di ricerca, mentre la FAQ ufficiale è accessibile.

## Ordine suggerito, da inserire nel piano solo se scelto

1. Unificare l'accesso Scryfall: debounce/deduplica, cache, deadline/abort, Retry-After e coordinamento delle chiamate server. Misurare chiamate upstream per ricerca/import e risposta ai429. Confrontare client attuale e SDK in una prova server; nessun SDK Node nel bundle Expo senza verifica Metro/Hermes.
2. Per i report web, provare un grafico partite per settimana su aggregati completi già autorizzati. Confrontare Recharts con UI attuale per bundle, tooltip/campioni, accessibilità e layout. Dominio/calcoli restano condivisi e indipendenti dal renderer; native conserva un renderer specifico.
3. Valutare importazione testuale, poi catalogo bulk locale se richiesto da ricerche offline o elaborazioni carte massive. Dataset completo e aggiornamenti sul server; sul telefono soltanto subset/cache necessari.

## Fonti primarie consultate

- Scryfall FAQ e bulk recommendation: https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17
- SDK TypeScript: https://github.com/ChiriVulpes/scryfall-sdk e README/package.json upstream
- MTGJSON formati/dataset: https://mtgjson.com/downloads/all-files/
- Deprecazione MTG API: https://docs.magicthegathering.io/
- Peer React del componente: https://raw.githubusercontent.com/germanyn/reactjs-mtg-card/master/package.json
- Icone: https://github.com/andrewgioia/mana e https://github.com/andrewgioia/keyrune
- Motori: https://github.com/arcanite24/open-gathering e https://github.com/Card-Forge/forge
- Parser: https://github.com/lheyberger/mtg-parser
- Grafici/UI: https://github.com/recharts/recharts e https://www.tremor.so/

Queste opzioni non sostituiscono i ticket originali DEV26 ancora aperti; nessuna aggiunta di dipendenze è implicita nella valutazione.

## Attuazione autorizzata dal PM18-11 — punti1 e2

- Scryfall: unico trasporto `packages/data/scryfall-transport.ts` per server, browser ed Expo. Intervallo prudenziale550ms fra avvii; massimo2retry su429/5xx selezionati, Retry-After numerico/data HTTP e cooldown condiviso, deadline15s che comprende coda e corpo. Dedup per URL con abort indipendente dei sottoscrittori; cancellazione upstream quando nessuno resta. Cache pubblica massimo128risposte da16Kcaratteri ciascuna, TTL60s per200/10s per404; nessuna cache di errori transitori. Le cache applicative preesistenti di illustrazioni restano separate. Cache CMC limitata500nomi, risultati negativi10s e positivi1h, errori temporanei non convertiti in assenza persistente.
- Nessun SDK esterno: gli endpoint effettivi sono pochi, il trasporto usa Fetch standard e il gestore deadline già condiviso. Elimina implementazioni duplicate senza introdurre SDK Node nel client Expo. La coda coordina un runtime; non promette quota globale fra processi, repliche o dispositivi dietro NAT. Immagini statiche escluse.
- Recharts3.11.0 con peer esplicito react-is19.3.0, soltanto web. Sostituisce il donut CSS già presente nei dettagli mazzo: settori da conteggi vittorie/patte/sconfitte, centro dal win rate già calcolato sulle partite decisive. Il renderer precedente mescolava denominatori (win rate decisivo e quota patte sul totale); i settori ora rappresentano gli esiti reali. Nessun nuovo report o calcolo di business. Import dinamico solo quando si apre il pannello, animazioni disattivate, riepilogo accessibile e conteggi testuali conservati. Expo invariato nel rendering. Redux Toolkit arriva transitivamente da Recharts per stato interno, non è uno store applicativo aggiunto.
- Nessun parser, catalogo bulk, motore regole, font o altra libreria aggiunti. Non aggiungiamo grafici temporali o integrazioni non richieste.
- Audit18-11: il gate produzione dipendenze segnala5high web e26high Expo, tutti su catene preesistenti (picomatch4.0.7 e minimatch10.2.6 invariati; lock Expo invariato). Recharts/react-is e i loro nuovi nodi non hanno advisory nel report. Picomatch GHSA-fc5q-39xc-vjpf è stato aggiornato17-11 e al controllo non ha versione corretta disponibile; il gate resta rosso, nessuna deroga o soppressione. Correzione/mitigazione verificata richiesta prima della consegna finale e distribuzione; le prove locali di compatibilità non equivalgono a readiness di rilascio. Report grezzi: `artifacts/dev26/scryfall-recharts-audit/local/`.

Ultima revisione: errori HTTP CMC mantengono il risultato facoltativo null ma non entrano nella cache; errori rete/abort conservano il contratto precedente. Il catch del lookup server commander è fuori da unstable_cache, con nuova chiavev8: un errore del provider non viene persistito come null per30giorni. Regressione usa una cache simulata dei soli risultati risolti, non un mock pass-through. Advisory Picomatch: https://github.com/advisories/GHSA-fc5q-39xc-vjpf.
