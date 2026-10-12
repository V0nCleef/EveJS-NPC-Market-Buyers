# Changelog

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
