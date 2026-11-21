# Admin users and activity / Utenti e attività

Candidate 9.3.0, Dev only. Open `/admin/users` after signing in with an existing platform administrator account, or use the Users link from the dashboard. The admin navigation also links to access logs and operations. Ordinary accounts cannot open the directory or call its API.

## Filters and reports

Search username, display name or email. Combine email confirmation, signup dates, logged activity and platform filters. Signup date boundaries use UTC; displayed timestamps use the browser timezone. Apply filters explicitly: an unapplied draft does not change results or CSV. The URL preserves applied filters and supports browser back/forward and reload. Clear filters resets the directory.

Summary cards cover every matching user, independently of pagination. Page sizes are 25, 50 or 100; ordering includes a deterministic user-ID tiebreaker. The directory excludes anonymous and soft-deleted accounts. Deck counts include archived decks; game and group counts describe current database records.

Access logs are retained for 30 days. Missing logs do **not** prove an account has never used the application; administrators may be excluded from normal logging. The platform filter matches any retained access from that platform. The last-platform column describes the latest retained log, which can therefore differ from the selected platform for a user who accesses both clients. “No log in 7 days” and “No available log in 30 days” describe available evidence, not account suspension or churn.

CSV exports use the applied filters and one database snapshot, across all matching pages. Limits: 5,000 matching users and 8 MiB. Oversized exports fail explicitly; narrow the filters and retry. The file includes generation time, filter values, matching count and retention information. Spreadsheet formula prefixes are escaped. CSV contains personal account data: use existing administrative handling procedures. No IP addresses, tokens, passwords, raw metadata or service credentials are included.

## Uso italiano

Accedere con un amministratore esistente e aprire **Utenti e attività**. Combinare ricerca, conferma email, periodo di registrazione UTC, attività e piattaforma; premere **Applica filtri**. Le schede riassumono tutti gli utenti filtrati. Il CSV usa gli stessi filtri applicati e comprende tutte le pagine, entro 5.000 utenti / 8 MiB. Per quantità maggiori restringere i filtri.

I log coprono soltanto gli ultimi 30 giorni: assenza di log non significa assenza assoluta di utilizzo. Un utente che usa web e app può soddisfare entrambi i filtri; la colonna piattaforma mostra l'ultimo accesso registrato. Il pannello è in sola lettura.

## Implementation and verification

- `lib/admin-users-contract.ts`: validated filters, typed reports, CSV encoding and formula protection.
- `lib/admin-users-server.ts`: privileged RPC, deadline and complete-result validation.
- `/api/admin/users`: session and administrator verification before service access, private responses, fail-closed rate limits (60 requests/minute, 3 exports/hour per administrator).
- `public.admin_user_directory_v1`: service-role-only SQL function; ordinary authenticated and anonymous roles have no execute grant.
- `hooks/use-admin-users.ts` and `components/admin/admin-users-panel.tsx`: lifecycle, URL state and responsive presentation.
- `scripts/qa/admin-user-directory.sql`: rollback-only 1,005-user SQL fixture, filters, aggregates, page boundaries, exports and role-denial assertions. Included in CI.
- `scripts/run-dev26-admin-e2e.mjs`: Dev-only disposable administrator/member fixtures, local candidate build, desktop/mobile real-backend browser checks and verified cleanup. Logs and screenshots live under ignored `artifacts/dev26/`.

The migration is applied only to Dev. Production and release deployment require their own authorized promotion; this document does not certify a production rollout.

Verified candidate commits: `8de4dd22` and `b2039b22`. Dev SQL fixture: 1,005 users, first query 27.71 ms; HTTP RPC allows service role and rejects anonymous/member credentials. Raw migration SHA-256 matches the Dev migration registry. Dedicated tests: 28 passed. Web quality: 427 tests and 53 script tests passed before the additional byte-limit test; Expo quality: 364 passed. Candidate build: 54 routes, 2.80 MiB JavaScript against the unchanged 18 MiB budget. Browser admin flow passed desktop/mobile, including applied filters, full CSV, empty state, reload/history, ordinary-member denial and no serious/critical WCAG A/AA Axe findings. Screenshots inspected in `artifacts/dev26/admin-users-{desktop,mobile}.png`; backend fixtures and synthetic administrator allowlist cleaned and verified on the final run. The existing Next/Sentry response-listener warning remains under investigation and was not silenced.
