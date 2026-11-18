# Valutazione librerie MTG — 2026-11-18

Ambito: candidato Dev9.3.0/90300, branch improvement/dev26-foundation. Verificati manifest/lockfile di web ed Expo e utilizzi reali. Analisi delle opzioni: nessuna installazione o migrazione proposta è stata eseguita.

| Opzione | Stato nel repository | Valutazione |
|---|---|---|
| Scryfall API | Già usata per comandanti, immagini/illustrazioni, CMC e colori; client propri in lib/scryfall.ts ed expo/lib/scryfall-search.ts, più chiamate dirette in altri moduli | Mantenere il fornitore; consolidare gli accessi e il controllo del traffico prima di cambiare client |
| scryfall-sdk / Scrython | Assenti | SDK TypeScript da provare solo dietro adapter server se riduce codice e conserva abort/cache/errori. Scrython richiede Python e non giustifica un nuovo backend |
| MTGJSON | Assente | Candidato per catalogo locale/enrichment/import batch: le statistiche delle nostre partite derivano dal DB dell'app, non dal catalogo carte. Valutare prima anche bulk Scryfall, mantenendo identità/provider coerenti |
| magicthegathering.io | Assente | Scartare nuove integrazioni: documentazione ufficiale dichiara API deprecata e funzionamento fino al1marzo2027 |
| Mana Font / Keyrune | Assenti; simboli mana già renderizzati con SVG Scryfall | Mana Font utile se servono più simboli; Keyrune quando esistono vere funzioni per espansione. Valutare subset di asset locali/accessibilità e licenze dei singoli asset; CSS/font web non è un'integrazione nativa Expo automatica |
| reactjs-mtg-card | Assente; immagini/presentazioni carte già proprie | Il manifest upstream dichiara peerReact^16.0.0; il progetto usa React19. Non scegliere questo componente come base senza un fork/test dedicato; le immagini esistenti coprono il bisogno attuale |
| Open Gathering / Forge | Assenti; motore tracker proprio condiviso in packages/domain/live-game*.ts | Motori completi di regole/simulazione non sono un sostituto diretto del contatore. Il nostro stato non contiene mano/campo/pila/priorità necessari a quelle simulazioni |
| Parser decklist | Nessun pacchetto della lista; importatori Archidekt/Moxfield propri | Utile nuova funzione TXT/MTGO/Arena. Separare parsing testo, risoluzione nomi e adattatori HTTP; validare quantità, commander/sideboard, partner, DFC, apostrofi e nomi localizzati. Il nome mtg-parser è ambiguo: il repository verificato lheyberger/mtg-parser è Python |
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
