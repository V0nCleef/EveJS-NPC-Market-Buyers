# Version 0.1.21 — EveJS 261108.1 compatibility

The first private retail-client run exposed a login-delivery defect that the earlier boolean-only codec fixture missed: the actual release emits numeric `0`, while the old NPC wrapper matched only boolean `false`. The candidate accepts exactly those two reviewed values. A real-release numeric-zero regression fails before and passes after the one-condition fix; six delivery contracts pass, including legacy false, unknown-flag rejection, duplicate suppression, codec metadata preservation and other-companion composition. The native payload is unchanged by this follow-up.

The one-file JS update was applied to the lab and staged runtime while the existing Launcher OS lifecycle leases for both roots were held by its Python owner. Both helpers verified afterward; all five native files, installer receipts/backups and NPC SQLite families retained their exact before/after hashes. No Rust rebuild was performed for this JS fix.

After fully closing the manually injected diagnostic client, a completely fresh build-3396210 client process received the companion through the normal numeric-zero login. All four companions coexisted. Native Orders (Icons, Details and List), Statistics, Activity and the real Sell Items advisor passed client checks. The advisor displayed an actual CCP ESI reference and the configured price-cap warning. The normal-login arm used no manual injection or fixture preload.

The unchanged scheduler bought six units from actual client-created sell order 1382 under operation `npc-market:1794249544032:140000008:34:60015249`. A later one-unit purchase used a different cycle key. The cold restart retained the exact original daemon-fill, wallet-authority, inventory-custody, Activity and sales receipts with no duplicate payment. The read-only receipt digest before/after was `99825bb6d0b06ae4727eb1c925880cb9bdc670da8681907607bd2ed6f04543d2`. At that control point, two purchases represented seven units, 0.07 ISK net income, 93 units remaining, seven institutional hangar units and a 99,900.07 ISK seller balance. Later ordinary cycles remain distinguishable by their own operation keys. No synthetic history or policy/scheduler edit was used.

A quick same-character logoff/reselection retained a usable companion, four unique subscriptions, one dashboard window and unique payment receipts. Its initial timing control selected before the native session timer/view had settled and while Daily Login Campaigns was open; that stricter timing-aware control is not claimed as qualified. The fresh-process normal-login and cold-receipt controls passed independently. Observed client exceptions were stock XMPP connection/leave-channel failures; no NPC companion exception was observed in the normal UI arm.

Source baseline: the actual EveJS-261108.1 ZIP, SHA-256 `373266a05fd9acf0c220d06d5469907637a6d09bf2cf926adf4aaee97a3ccc59`. The four Rust overlays were merged against that release, retaining its new due-order index, expiry batches and price/time ordering. The executable was rebuilt offline with the locked dependencies.

- 31 Rust tests passed, including conditional-fill identity/idempotency, expiry batching/index use, price/time ordering, transaction rollback and concurrent writes.
- 104 focused Node checks passed against the actual 261108.1 JavaScript sources. These include four new actual-release identity/install/migration/unknown-executable controls; wallet, settlement/recovery, pricing, statistics, native codec and composition with the 1.2.26 AutoMining candidate and the retained Launcher shared-menu wrapper.
- The real native daemon and wallet authority passed isolated personal/corporation purchases, tax, item custody, order quantities, random/offline buying, restart idempotency, lost-daemon-ack recovery and lost-wallet-ack recovery. Writable databases and random localhost ports were task-owned.
- The actual loader attached its login hook and market service, reached the rebuilt daemon and answered the dashboard RPC in an isolated 261108.1 source fixture.
- 83 existing client contracts passed using retained build-3396210 reference source. Source/catalogue validation passed for 257 strings in eight languages, six Python files, 17 JavaScript files and five matching native payload members. Python 3.11 ran these existing portable scripts; this is not execution inside the retail Python 2 client.

GridCheck qualification used only the dedicated lab actor and preserved the buying policy. The old hard-coded 0.12.9 staging tools and the unexecuted seed fixture are historical and must not be staged into this lab. No played-world fixture, shared-client archive, global Launcher setting or release was changed. Docker and production purchases were not tested. The staged runtime's financial data remained unchanged during the guarded installation/update.

The published asset is the exact previously qualified ZIP. Repository publication text is newer than the packaged local verification snapshot; executable JS, client Python, native source and payload bytes are unchanged. Josh reported a basic gameplay check as working before approving publication.

## Earlier 0.1.20 verification

# Version 0.1.20 — EveJS 261028.1 compatibility

The corporation-wallet transform accepts the two reviewed native notification shapes. New null-balance cache invalidations remain immediate and preserve their count and arguments. Numeric NPC notifications retain personal/corporation batching, division isolation and current-balance delivery. Authoritative wallet commands, identities, tax, settlement and native market payload are unchanged.

- 87 focused Node checks passed against actual 261028.1 sources: wallet batching and restart receipts, settlement recovery, installer lifecycle guards, statistics, local pricing, native login codec, AutoMining composition and Launcher 1.0.74 shared-menu wrapper.
- 83 client contracts passed using retained client-build-3396210 reference source: Sell Items advisor, HUD/settings/history/statistics, menus and native Wallet formatting. All 257 strings retain eight-language coverage; six client Python files and 17 JavaScript files pass source validation.
- Real isolated Rust-market and wallet-authority integration passed: personal/corporation purchases, tax, item custody, order quantity, unlimited/random/offline buying, restart idempotency and recovery after lost daemon and wallet acknowledgements. Both updated wallet transforms and batching were active. Databases and random localhost ports were task-owned; player databases were not used for tests.
- The four Rust overlays and executable are exactly the existing 0.1.19 payload. No Rust change or rebuild was needed because upstream market sources are unchanged in this upgrade.

The release preserves the exact ZIP validated locally, including its pre-publication documentation snapshot. The public source documentation records publication and this later confirmation: on 30 October 2026 the maintainer reported that the current installed mods appear to work in gameplay. This is user-reported confirmation, not an automated retail-client test. Automated retail rendering, real ESI pricing, Docker and extended soak coverage were not rerun for 261028.1. A server restart and client reconnect are needed after updating to load the repaired companion.

# Version 0.1.19 verification

The included native source and executable preserve EveJS 261018.1 station metadata and order validation while retaining conditional fills, wallet/escrow settlement and trade-history idempotency. The payload also supports the tested EveJS 0.12.9 baseline. In-game client code and UI are unchanged.

The manifest requires Launcher 1.0.74 and opts into `prepare_server_start`. Healthy active support returns without writes or service-inactivity checks. A complete recognized upstream source replacement is repaired only while both native services are stopped. Disabled/absent support is never silently installed. Partial or unknown changes, invalid rollback backups and interrupted disable/removal stop before replacement. Interrupted active repair resumes only from durable exact source identities.

Nineteen focused lifecycle tests passed, including automatic repair, healthy no-op byte/mtime checks, running-service refusal, preserved settings/history SQLite bytes, unknown/partial source rejection and interrupted repair/disable behavior. Portable source/catalogue validation covers 257 strings in eight languages, six client Python files, JavaScript syntax and five matching native payload files.

An isolated copy of EveJS 0.12.9 was upgraded to 261018.1 with the actual official updater. The real Launcher startup path automatically repaired NPC Market Buyers before starting a real native market process; its health RPC passed. Starting the game while that market was healthy performed no repair writes. Game spawning was simulated: this check did not start the EVE client or a real game server. Busy-service and unknown-edit controls blocked startup without writes; a market-only retry repaired successfully. The saved settings/history database remained byte-for-byte identical and no manual Recover action was used.

Earlier testing of this exact native payload passed 23 existing Rust tests plus a station-metadata/conditional-fill regression, 82 focused Node contracts and real isolated native purchase settlement against EveJS 261018.1: personal/corporation payments, tax, custody/escrow, quantities, random/offline batches, restart idempotency and lost daemon/wallet acknowledgement recovery. No live installation, financial database or game client was changed for these checks. New live HUD rendering and real ESI pricing were not rerun.

## Earlier 0.1.18 evidence

# Version 0.1.18 verification

The installation change removes file-hash and exact-version gates. Native files are backed up from the selected installation and restored on removal. File paths, package completeness, stopped-stack checks and unfinished-settlement recovery remain checked.

Clean-source testing uses the unmodified server JavaScript from the official EveJS 0.12.9 source ZIP, with dependencies and a small selection of static reference data supplied separately. The installer creates the missing native executable. The real native purchase harness passed personal/corporation purchases, random batches, offline catch-up, lost daemon/wallet acknowledgements and restart recovery with no duplicate payment. All test processes and writable databases are isolated; no live installation update or restart is performed.

Focused checks passed: 57 installer, login, settlement, scheduler and wallet contracts; 23 pricing/policy tests; four package/update-metadata checks; and four actual Launcher update/rollback checks. Two Launcher checks were skipped: public-hosted download (this candidate is not published) and the optional legacy ZIP bootstrap. Catalogue/source validation covers 257 strings in eight languages, client Python grammar and JavaScript syntax.

The UI is unchanged. Earlier in-client visual approval is recorded below. Removing a version lock is not a claim that every future EveJS API change has been tested.

## Earlier 0.1.17 evidence

# Verification — NPC Market Buyers 0.1.17

Version 0.1.17 adds Launcher update metadata and automatic sidecar packaging. Gameplay, client code and the five-file native market payload are unchanged from 0.1.16. The visual and accounting evidence below applies to the approved 0.1.16 implementation. The maintainer requested publication as a new version and a local installation update on 2026-10-11.

## Launcher updates

- Four portable checks build the finished ZIP and validate its derived sidecar, reject undeclared legacy packages and wrong asset names, and prevent accidental standalone sidecar overwrites. CI runs these checks for future releases.
- The actual Launcher checker and downloader accept matching mod identity, version, ZIP name and EveJS 0.12.9 compatibility. Checks reject a missing or mismatched sidecar, unsupported EveJS 0.12.8, and an already current version. HTTP responses are local fixtures in this pre-publication test.
- The actual Launcher replacement path is exercised in stopped disposable roots for enabled and disabled packages. The saved policy/activity SQLite database and an unrelated save remain byte-for-byte unchanged. The database passes its integrity check, and no recovery job remains pending.
- A deliberately failed candidate activation restores the previous package and its enabled state. Its five native files again match the previous installed hashes, and the real helper verifies the restored installation. No stack or client is started for these update tests.
- The older update-capable package in replacement tests is explicitly synthetic. A separate test imports the original 0.1.15 ZIP, confirms that it has no update source, then uses actual Launcher remove/import/enable actions to install 0.1.17 while preserving the saved database. This is the required one-time manual bootstrap for real older installations.
- The portable checks need only Python. The real Launcher integration also needs the Launcher's Python dependencies, including PyQt6; it uses that environment and does not stub the version/compatibility check.

## Accounting and persistence

- The permanent sales ledger records only settled NPC purchases. The ledger and settlement state update in the same SQLite transaction. Unique operation keys prevent double-counting after recovery.
- Existing settled operation receipts migrate once, including sales whose Activity entries the former 5,000-row limit deleted. Migration changes accounting records, not wallets, inventory or market fills.
- Active-order Sold uses actual receipts, including receipts from before an asking-price change. Remaining uses current quantity times current asking price. Total is their sum, before sales tax. Closed orders are excluded from that header.
- Statistics includes archived sales and offers all history or any whole number of days from 1 to 36,500. Tests cover exact rolling boundaries, zero-sale buckets, offline dates, account isolation, unknown historical tax and restart persistence.
- Recent Activity is limited to 500 entries no older than 30 days. Archive retains older entries without deletion. Keyset paging returns up to 100 entries and handles tied timestamps.

## Performance

- A 100,000-sale SQLite fixture verifies complete totals while Activity returns 100 rows and graphs return at most 61 buckets. Daily aggregates serve complete days; indexed receipt queries handle partial days.
- Combined Statistics, Activity and checked RPC queries took 26–43 ms in local runs. Creating the 100,000-entry synthetic fixture took seven to eight seconds. These are separate measurements, not a claim about EVE drawing time.
- Real-client Statistics RPCs with 12,010 persisted purchases took 10–30 ms across repeated runs for all history, 17 days and 36,500 days. The final rendered run took 10–13 ms.
- Unchanged Statistics responses do not rebuild the screen just because the response clock advances. Custom-range selection and the numeric entry remain available during ordinary polling.

## Native visual integration

- GridCheck 0.2.0 ran on the disposable EveJS 0.12.9 playground, with separate data and ports 45380–45390. The native market and real EVE client build 3396210 were used.
- The fixture created ten actual sell orders and completed ten native purchases. Receipt totals were Sold 266,136,500 ISK; Remaining 714,462,500 ISK; Total 980,599,000 ISK.
- Another 12,000 clearly marked historical entries supplied 90 days of graph and archive data. Those synthetic entries did not issue money or inventory changes. Combined fixture totals were gross 56,897,756,880 ISK, sales tax 4,551,820,548 ISK and net 52,345,936,332 ISK.
- The repeatable scenario opens the normal mod window, asserts accounting values, checks all three Orders and Activity views, verifies reversible archive paging, applies 17 custom days and captures the minimum-size layout. Ten actual client screenshots were captured. The fixture world was tested again after restarting the isolated server.
- One cold-client run passed its UI assertions but captured the loading screen. Those captures were not accepted as visual evidence. The scenario now refuses visual checks while the station loading layer or loading indicator is visible. The final `npc-buyers-statistics-016-rendered` run passed all assertions, reported no client exceptions and produced ten usable screenshots, retained separately from the earlier captures.
- The GridCheck client does not have the Launcher Mods menu. The scenario calls the same mod `open_window()` entry point used by that menu. Login delivery accepts only the exact GridCheck client-agent v1 hunks on the reviewed handshake baseline; unrelated changes still fail the hash guard.

## Automated checks

- All 84 server/native contracts, 81 authored client contracts and two native Wallet formatter contracts pass. Exact run counts and timings are retained in local evidence.
- All 257 authored strings are complete in all eight supported languages, with matching placeholders. Readable currency uses the native client's localized wallet functions.
- Python 2 grammar, host compilation, JavaScript syntax, metadata and all five payload hashes pass. Packaging excludes fixtures, private client references, test databases and evidence.

## Practical limits

The displayed historical fixture is invented test data, apart from its ten actual test purchases. Performance figures describe this machine and these workloads. Existing receipts missing tax produce an explicit warning because net earnings cannot be reconstructed exactly. Broker fees are excluded from net earnings and explained in the help popup. Historical offline dates remain simulated; historical market prices are not reconstructed.

The final visual scenario passed all setup assertions and its no-client-exceptions expectation. Cleanup stopped only test client PID 48132, GridCheck server PID 3532 and its native market PID 46952. Final checks found zero listeners on GridCheck's ports, no remaining test client and all nine protected live files unchanged. Earlier checks confirmed the original live server and six live clients remained running; by the last snapshot the live server and clients were no longer running. No command in this test stopped or restarted that live stack.

Maintainer approval covers the demonstrated isolated test. Installation in another game remains subject to the normal compatibility and stopped-stack checks.
