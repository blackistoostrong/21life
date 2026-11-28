# DEV26-04 — Isolated Android PR core

The previous Android smoke workflow was manual and pointed at staging. The new reusable `android-core.yml` is called by Quality on its existing PR/push events. The required `web` check explicitly fails unless both `web-checks` and `android-core` succeed, including skipped/cancelled results. Branch protections and the separate manual infrastructure smoke are preserved.

The job installs both existing lockfiles, starts a disposable local Supabase stack including Realtime, applies the current migrations, builds the web API and compiles an x86_64 Dev debug APK. No Dev/production secrets or remote backend are used. `native-ci-config.mjs` requires the CI marker, Dev variant, exact loopback endpoints and coherent public/private keys before provisioning. Existing bounded Auth/REST and preview preflights are reused. The service key stays in the Node fixture runner; only the local anonymous key reaches the clients.

The emulator installs `com.phyrexianarena.app.dev`. ADB reverses only the local Metro/API/backend ports. Each of three consecutive runs provisions two new synthetic users, a group and two personal decks, then executes the existing authenticated live and archive flows. Failures stop the core; the three runs are independent confirmations, not retries of a failed suite.

The live flow covers real keyboard input, explicit two-player selection, scrolling, damage39, rotation, OS process death and reopening the owned game before finalization. The archive flow covers archive/restore. The SDK oracle requires exactly one draw with the two fixture participants and the original deck restored. Group/account cleanup is verified for every run. Proof records source SHA, APK SHA-256 and per-run results; text artifacts are redacted even if cleanup fails. The local CI backend is removed unconditionally by the workflow.

Maestro2.13.0 is pinned with the official release ZIP SHA-256. No app dependency or database migration was added. The player-count controls expose a meaningful accessible label/selection state, avoiding the decorative step/preview numbers that confused the old test.

The CI debug package does not configure Firebase and does not certify push delivery. It is neither a production build nor an Obtainium release. The separately configured release workflow remains responsible for release signing and Firebase configuration.

## Verification status

Initial local checks:19 tooling/preflight contracts pass, including four CI isolation cases; workflow/flow YAML parses; JS lint, native typecheck and feature boundaries pass. Full APK compilation and three successful emulator runs are still required before this work can be called verified or integrated. Local Expo Go57.0.9 startup/login evidence is useful for the renderer but does not substitute for that APK gate.
