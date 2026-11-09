# Changelog

## 0.1.23 — Pending updates and receipted recovery (2026-11-10)

- Updates enabled 0.1.20–0.1.22 installations without disabling Native support first. Requires Launcher 1.0.79+; keeps pending work, policy and history through replacement and exact rollback.
- Recovers a narrowly proven historical failure where a personal NPC purchase moved goods and money but the daemon permanently recorded a terminal zero fill and the Native escrow anchor disappeared. Returns the intact stack to the seller's station, refunds tax and reverses the failed purchase through Native owners with durable per-effect receipts.
- Resumes compensation after lost replies and restarts without repeating goods or wallet changes. Keeps legitimate institutional funding and records compensation without inventing a successful sale.
- Defers expiry returns while an NPC settlement remains pending. Normal startup and later polls retry without advancing the expiry cursor past unfinished work.
- Keeps ambiguous or unsupported recovery cases blocked, including changed goods, unproven payments and uncertain evicted receipts. Actual disable/removal also checks the compensation journal.

## 0.1.22 — Unpublished update-only candidate (2026-11-09)

- Updates enabled 0.1.20/0.1.21 installations without first disabling native market support, including when a purchase was interrupted during shutdown. Requires Launcher 1.0.79+.
- Retains pending payment, goods and fill identities for normal recovery after restart. Buying policy, permanent sales history and the native payload are unchanged.
- Restores exact previous native files and the installation receipt if an update fails. Supports recognized official EveJS source replacements and preserves their new uninstall originals.
- Keeps the unfinished-settlement guard for actual disable/removal, and refuses unknown source changes or incompatible settlement schemas.

## 0.1.21 — EveJS 261108.1 compatibility (2026-11-09)

- Restores the in-game companion on current native logins, including the dashboard and Sell Items advisor.
- Preserves EveJS 261108.1 indexed expiry batches and price/time ordering in the rebuilt native backend.
- Recognizes the new stock source set and prior 0.1.19/0.1.20 payload during guarded update recovery.
- Retains buying policy, sales history, pending-settlement protection and exact new-version uninstall originals.

## 0.1.20 — EveJS 261028.1 wallet compatibility (2026-10-30)

- Restores runtime and menu attachment on EveJS 261028.1 by supporting its new corporation-wallet null-balance notification shape.
- Preserves immediate corporation cache invalidations, numeric personal/corporation notification batching, wallet division isolation and current-balance delivery.
- Retains Activity/history, saved settings and the matching five-file 0.1.19 native market payload. No state reset or financial replay is required.
- Adds focused regression coverage and adapts the isolated corporation fixture to native persisted membership and role checks.
- Requires Launcher 1.0.74 or newer. Stop the Native stack before updating, then start it and reconnect EVE. Native Windows only.

## 0.1.19 — EveJS 261018.1 and automatic update recovery (2026-10-19)

- Supports EveJS 261018.1 while preserving its native station metadata and order validation.
- Repairs native market support automatically after a supported official EveJS update, before either native service starts. Requires Launcher 1.0.74 or newer.
- Preserves saved settings and purchase history. Refreshed rollback originals prevent later removal from restoring the previous EveJS version.
- Leaves healthy installs untouched, including when the native market is already running. Unrecognized or partial source changes stop startup without overwriting them; interrupted disable/removal stays manual.
- Retains existing pricing, purchase settlement and in-game UI behavior. Native Windows only.

## 0.1.18 — Simple installation (2026-10-12)

- Removes native baseline/content hash gates, login-source fingerprints and the exact EveJS version lock.
- Backs up the user's actual market files, installs the packaged executable/source, and restores originals on removal. Fresh source ZIPs do not need a precompiled market executable.
- Existing installation receipts keep their original backups. Repair/reinstall accepts rebuilt native files.
- Fixes the purchase completion hook for clean stock EveJS as well as local trade-history builds.
- Retains stopped-stack protection, interrupted-install recovery and unfinished-payment recovery checks.

## 0.1.17 — Launcher update support (2026-10-11)

- Adds the missing GitHub update source and matching release metadata so future compatible versions appear in Launcher → Mods → Check mod updates.
- Builds the update metadata from the finished ZIP automatically and checks it in CI.
- Earlier versions need one manual ZIP update to gain update detection. Settings and sales history stay outside the package and are preserved.
- Gameplay, client UI and the reviewed native market payload are unchanged from 0.1.16.

## 0.1.16 — Sales statistics and archived Activity (2026-10-10)

- My Sell Orders shows actual NPC sales, remaining asking value and their combined total for active orders.
- Statistics shows sales before tax, sales tax, net earnings, top items and online/offline earnings, with graphs for all history or any whole number of days from 1 to 36,500.
- Activity keeps up to 500 recent entries no older than 30 days. Older entries remain browsable in Archive, with 100 entries per page.
- A permanent accounting ledger preserves totals when Activity is archived. Existing completed purchase receipts migrate once without creating payments or double-counting sales.
- ISK displays add localized wallet-style thousand, million, billion and trillion descriptions, including Sell Items advice and the mod's Wallet descriptions.
- Order labels explicitly say Order ID, which is the EveJS market identifier rather than a count of sales.
- Daily summaries keep Statistics queries small, and unchanged statistics no longer rebuild the window every refresh.

## 0.1.15 — Remaining stock bars

- My Orders bars start full and drain as units sell, showing the stock still for sale.
- Details captions and help text match that behaviour in all eight client languages.
- Icons, Details and List retain their original and remaining quantity displays.

## 0.1.14 — Clearer online Wallet descriptions

- New online sales identify the item, quantity, unit price, gross income, actual tax and net income.
- Tax, refund and reversed-payment rows identify the affected item and amount.
- Names follow the client's language. Existing wallet rows keep their original descriptions.

## 0.1.13 — Offline income summaries

- Offline catch-up produces one net-income popup and a bundled Wallet summary per wallet/division.
- Individual item sales remain available in Activity and Market Transactions.
- Catch-up yields between purchases to improve responsiveness.

## Earlier development

Established TQ hub pricing, EVE average and local NPC offer fallbacks, Unlimited/Limited modes, randomised batches, optional offline buying, localized sell advice, configuration help and inventory-style views.
