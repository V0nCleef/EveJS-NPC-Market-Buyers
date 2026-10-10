# Verification — NPC Market Buyers 0.1.16

Version 0.1.16 adds active-order financial totals, archived Activity, Statistics and wallet-style readable ISK amounts. The five-file native market payload is unchanged from 0.1.15. The maintainer approved the isolated in-game test and authorized publication on 2026-10-10. The player's Launcher installation was not updated as part of this release.

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
