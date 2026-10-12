# NPC Market Buyers 0.1.18

NPCs buy your sell orders in single-player EveJS using configurable probabilities and current TQ prices. The real **Sell Items** window shows the actual price reference, your price percentage, warnings and the base NPC chance while you edit each item. A native in-game dashboard provides **My Orders**, **Configure**, **Activity** and **Statistics**, opened from the Launcher's shared **Mods** menu.

The graphite/teal dashboard shows item icons, original and remaining quantities, remaining-stock bars and subtle status pulses. Navigation and action buttons share one bottom row with stable native sizing. The mode badge sits beside the TQ reference, and progress bars align under the quantity columns. Each setting has a circled **!** with native hover/click popup help; Configure has no permanent help pane. Activity shows purchases, quantities, gross payment, sales tax and net received, with separate pending/confirmed recovery statuses. A missing original quantity or tax is explicitly unavailable.

## Install

This guide covers version 0.1.18.

Tested with the Native backend, EveJS **0.12.9**, Launcher **1.0.69+**, and EVE client **3396210**. ZIP import and the real install/verify/prepare/disable helper lifecycle are checked against the current Launcher source in isolation. The new layouts are checked in an isolated real EVE client using GridCheck. Reconnect after updating to load the new companion.

1. Stop the game server and native market from the Launcher.
2. In **Mods**, use **Add ZIP** and select `NPC-Market-Buyers-0.1.18.zip` from the GitHub release's Assets.
3. Install/enable **NPC Market Buyers**, start the server, and reconnect the client.
4. Open **Mods → NPC Market Buyers** in game. Use the ordinary **Sell Items** window to see per-item advice before pressing Sell.

The helper backs up your actual native market files and installs the included executable and its four matching Rust source files. No baseline hashes, whole-file login fingerprints or exact EveJS version lock are used. A missing precompiled executable is fine. Backups and a recovery receipt live in `_local/npc-market-buyers/install/`. Disabling/removing restores the original files, including their original absence; settings, purchase records and NPC-owned goods remain. Changes made to these five files while the mod is enabled are replaced when restoring the saved originals. Stop the stack before installation/removal and resolve unfinished settlements before disabling. Use the Launcher recovery action after an interrupted install/remove.

The client companion is delivered at login, alongside AutoMining and the shared menu. No client archive patch is needed. Docker support is not advertised by this release.

### Update from an earlier version

My Orders bars now show the fraction of the original quantity **still for sale**. A new order starts full and the bar drains as units sell. This applies to the existing Details and Icons bars. The Details caption and help popup match it in all eight languages. List retains its numeric Original and Remaining columns. Unknown original quantities retain their unavailable explanation.

Stop the server/native market first and close EVE. For 0.1.16 or earlier, disable/remove the old package, import and enable the latest package, then restart and reconnect. Keep only one version enabled. Earlier packages have no update source, so this one manual import is necessary. From 0.1.17 onward, use **Launcher → Mods → Check mod updates**, then **Update** when a newer compatible release is offered. The `.update.json` release attachment is read by the Launcher; import only the ZIP.

The helper retains the same verified native payload and original rollback files. Settings and receipts live outside the replaceable mod folder. Completed purchase receipts are added to Statistics once on first start, without new payments or inventory changes.

Activity List keeps the same 36-pixel item thumbnails as My Orders. Non-purchase rows keep their settings/recovery/rejection symbols. Compact rows reserve room for their icons, help buttons and readable currency captions.

My Orders and Activity each have the same native menu button and Icons / Details / List symbols as EVE’s inventory, at the right of the page heading. **Details** shows full rows and is the default. **Icons** shows cards that automatically wrap as the window resizes. **List** uses compact rows, with full popup explanations available from the circled **!**. Original/remaining quantities, actual reference sources and NPC chance remain available. Activity retains dated groups, per-unit prices, quantities, net ISK, tax breakdown, offline timestamps and separate recovery statuses. Confirmed recovery rows never show another payment.

### Active-order values, archive and Statistics

Beside **My Sell Orders**, **Sold** is actual completed NPC sales for orders that are still active. **Remaining** is the unsold quantity at each order's current asking price. **Total value** is sold plus remaining. A price change does not rewrite earlier sale income. These values are before sales tax; closed orders remain in Statistics instead of the active-order header.

Activity's **Recent** view keeps up to 500 entries from the last 30 days. Everything older stays in **Archive**. Both views load 100 rows at a time with Previous and Next buttons. Archiving does not delete sales or remove them from Statistics.

**Statistics** shows sales before tax, sales tax paid, net earned, purchase batches, units sold, top selling items, online/offline earnings and average daily net earnings. Choose **All history**, a preset period, or **Choose number of days** and apply any whole number from 1 to 36,500. The chart groups days on longer periods; hover over a bar for exact amounts. Net earnings exclude broker fees. Old receipts with missing tax show a warning.

Money displays retain the exact amount and add the native wallet's readable wording, such as **≈ 266 million ISK**. This covers Orders, Activity, Statistics, budget fields, Sell Items advice and the mod's Wallet descriptions. Wording follows the client's language. **Order ID** is the market database identifier, not a sale counter.

Each tab remembers its own view in EVE’s native per-character UI settings, including across closing/reopening and reconnecting on the same client. These preferences do not modify inventory settings or the buying policy and need no Save policy action. Switching uses already-loaded data without issuing another server request. The normal refresh keeps the selected view. Configure does not have a view switcher. Existing order/activity response limits are unchanged.

Configure fields have small 32-pixel buttons immediately to their right, with two counterclockwise reset arrows and localized tooltips. Reset affects only that field in the unsaved draft; Save policy applies it. Resetting a region restores The Forge/Jita together. Resetting a station chooses the main trading station in the selected region. Custom regions without a curated main station keep their saved station until another region is chosen. Defaults come from the server, rather than a separate hardcoded client policy.

Scrolling over a Configure input, dropdown or reset button scrolls the page without changing a value. Typing and the numeric control’s explicit arrow buttons remain available. Resetting an already-default value, or resetting a changed value back to the saved value, does not create an unsaved-change warning.

In TQ mode an average fallback retries the preferred hub at the five-minute cache boundary instead of holding the fallback for its full one-hour cache. EVE average mode retains the average’s own expiry. Price data keeps its original timestamp, and the existing freshness and fair-price checks still apply.

This update compares the actual normalized form values with saved settings. Clicking/reselecting an unchanged option, changing a value and reverting it, or equivalent numeric formatting no longer blocks navigation. Save does not submit an unchanged policy or add an unnecessary settings Activity entry. Real unsaved changes and incomplete input remain guarded; edits during a save are compared with the accepted policy.

Reference region and station are named dropdowns. The five default pairs are **The Forge / Jita IV - Moon 4**, **Domain / Amarr VIII (Oris)**, **Sinq Laison / Dodixie IX - Moon 20**, **Heimatar / Rens VI - Moon 8**, and **Metropolis / Hek VIII - Moon 12**. Selecting a region filters the station list and automatically selects its main hub; new installations default to Jita. Hub identities and localized region/system names are verified against CCP SDE build 3396210. Existing custom references remain available as saved choices and are not replaced merely by opening Configure. Popup help exposes the underlying IDs.

The three ISK budget fields use the same native two-decimal numeric control as Wallet Transfer, including EVE's localized digit grouping while editing. A caption directly below each field updates with EVE's own readable money formatter, for example “250 million ISK” or “≈ 10 million ISK”. The client localizes these captions. Percentages keep their separate decimal input. Numeric policy values are submitted without display separators.

Configure now provides **Price reference → TQ trade hub / EVE average**. New and upgraded policies default to **TQ trade hub**. TQ uses the chosen hub first and retains the automatic per-item average fallback. Selecting **EVE average** uses CCP’s published `average_price` directly, even when hub orders exist; in Unlimited mode it does not fetch hub orders or regional history. This is a game-wide online EVE value, not the local EveJS market and not an offline price table. Both choices retain price ceilings, chance, batches and stale-data checks. When the online references are unusable, both choices can use a local NPC immediate-sale offer as their final fallback.

A third status at the top right shows **Prices: TQ trade hub** or **Prices: EVE average**, aligned with Active and Offline purchases. It shows the saved policy choice; per-item fallback labels show the actual fallback used. Click the status to open Configure, reveal/highlight the source control and open its popup explanation. Clicking does not toggle the setting or create an unsaved draft; Save policy applies a changed source. Configure shows only applicable settings, updating immediately with draft selections. Unlimited mode hides the whole budgets/daily-demand section; Limited mode reveals it. Random-batch minimum is hidden in fixed-batch mode. EVE average with Unlimited mode hides region, station and history lookback; with Limited mode it retains a clearly labelled Demand region and history lookback for the quantity quota, while hiding the station. Switching back restores the existing controls and unfinished drafts without rebuilding the page. Hidden settings keep saved values when submitting; irrelevant incomplete input cannot trap navigation or saving. Read-only users can view applicable settings, while their editors remain disabled. Fixed-batch validation ignores the unused random minimum; enabling random batches validates the now-visible minimum again.

The minimum-reference-order option is removed entirely. Old saved thresholds are discarded once without changing other settings or the purchase schedule. One valid hub sell order is enough; there is no configurable order-count gate. Existing offline-purchase choices, pricing, random-batch settings, schedule and receipts survive. Offline purchases defaults to Off on a new installation.

Saved policies gain random batches automatically, with a minimum of 0.01% and the existing maximum preserved. Old ten-minute schedules migrate to the fixed fifteen-minute interval and begin with a full interval; pending settlements keep their original identities and recover first. Pricing, chance, mode and other settings survive. The interval cannot be changed through the server API and is hidden from the client HUD, advice and Configure menu.

The 0.1.1 native HUD close fix is retained. The actual Sell Items advice now uses 14-point text and expands to fit wrapped translations. Every authored UI label, setting, warning, activity message and error is translated into English, German, French, Spanish, Russian, Chinese, Japanese and Korean, following the active client language. European decimal-comma input is accepted for numeric settings. Language changes refresh the companion without duplicate menu entries. Language IDs follow [CCP's client language list](https://developers.eveonline.com/docs/guides/staticdata/).

## Default policy

| Setting | Default |
|---|---:|
| Buying mode | **Unlimited mode - fair prices only** |
| Offline purchases | **Off** |
| Buyer check | Fixed at 15 minutes; hidden from the client UI |
| Chance at TQ reference | 35% per 15 minutes |
| Expensive warning | Above 110% of TQ |
| Cheap warning | Below 80% of TQ |
| Hard NPC price ceiling | 125% of TQ |
| Batch | Random 0.01%–10% of remaining grouped quantity, at least one unit |
| Shared daily item demand | No quota in Unlimited mode |
| Global / seller / cycle budget | No spending cap in Unlimited mode |
| Price reference | TQ trade hub (Jita IV – Moon 4, The Forge) |
| Maximum quote age | One hour |

At 90%, 100%, 110%, 120% and 125% of reference, the defaults yield 55%, 35%, 20%, 8% and 3% base chances per 15-minute check. Above the ceiling the chance is zero.

In **Unlimited mode**, any marketable player item with a fresh, reliable price reference can be considered, including a single low-volume item or an expensive ship. Local market emptiness and TQ trading-volume quotas do not affect eligibility. There are no daily, per-seller, per-cycle or institutional-funding spending caps. TQ price fairness, quote quality, native order validity, wallet precision and percentage-based buying still apply. Missing or unreliable price references are shown explicitly; the mod never invents a price.

The percentage is a chance to buy a batch, not a promise to clear the order. Quantity has a separate persisted random draw. Smaller purchases are more common, with meaningful chances for larger purchases (a log-uniform whole-unit distribution). A one-million-unit order can sell 100–100,000 units on a successful check; at 900,000 remaining the range becomes 90–90,000. A one-unit ship still sells as one unit. The sell window shows the current batch range. Configure provides random/fixed batch mode and minimum/maximum percentages. One persisted roll and at most one purchase per seller/item/station per cycle prevent splitting, relisting or restarts from generating extra chances. The cheapest eligible order in each group is considered first.

### Offline purchases

The main screen displays **Off**, **On**, **Catching up** or **Paused** directly under the engine status, with matching alignment and indicator shapes. Off is red; On uses the same green filled dot and gentle pulse as Active; catch-up is amber. Click this status to open Configure, reveal and highlight the toggle, and open its help popup. Clicking does not change the setting or discard a draft; use Save policy to apply a change.

New online NPC sales now have item names, quantities, unit prices, gross income, actual sales tax and net income in Wallet Transactions. Their tax rows identify the item and tax amount too. Item names follow the active EVE client language, with descriptions in all eight supported languages. Payments awaiting settlement and reversed payments are labelled explicitly. Online notifications and native credit/tax rows keep their existing timing and amounts; offline catch-up still produces one bundled summary. Existing online rows retain their native descriptions: the mod only annotates exact wallet receipt IDs it records from 0.1.14 onwards. Reconnect EVE after updating to load the formatter attachment.

Offline purchases now produce **one net-income Wallet notification and one bundled Wallet Transactions entry per wallet/division** after catch-up. The description shows the purchase count, gross income and sales tax; Activity keeps each item sale. Native financial receipts remain separate for crash-safe recovery. The summary survives restarts and retries, including batches larger than the native journal's 1,000-row limit. Unrelated wallet actions during catch-up remain immediate and split the summary where needed to keep running balances accurate. Existing 0.1.12 history is preserved; summaries apply to newly processed catch-up purchases. The native Market Transactions item history remains detailed.

Catch-up yields briefly between purchases and after every 25 evaluated groups. Unlimited mode also skips budget queries that cannot affect its decisions. These changes reduce notification work and improve scheduling fairness; native order, inventory, payment and tax processing still takes place for every sale.

With the toggle on, the persisted schedule resumes missed checks after a shutdown. One check runs per scheduler pass, with at least a second between passes. Each pass uses fresh current TQ data, currently valid orders and their current remaining quantities. No checks predate an order's listing; expired orders are skipped. Empty or entirely ineligible markets skip redundant history. Unavailable/stale TQ data cannot cause a purchase. Historical TQ prices are not reconstructed.

Successful catch-up purchases appear in Activity at simulated times spread across their missed intervals, with slight variation between orders. These times are persisted before settlement and survive recovery/restart. Activity sorts by that time. Hovering the time explains the simulation; the real wallet, tax and receipt timestamps remain the actual online settlement time. No purchases or income are invented: each Activity purchase corresponds to a confirmed settlement. Limited-mode budgets apply on the real settlement day.

Turning the toggle on or pausing/resuming starts a fresh interval; time while off or paused does not build a backlog. With offline purchases off, one overdue check may run at startup, and the older missed checks are skipped. Recovery of an already authorized pending payment always runs first, including while paused.

**Limited mode** restores the optional shared quotas and spending limits: 0.1% of recent TQ daily volume and 250m / 50m / 25m ISK global / seller / cycle budgets. Those controls and their section heading are hidden while Unlimited mode is selected. Exhausted item quotas and insufficient budgets have separate explanations.

All editable policy fields appear under **Configure**; the purchase interval is fixed and has no control. Any player can view the policy and their orders/activity; only a server owner or GM with a server-issued staff role can save policy changes. Configuration and schedule survive restarts. Pausing prevents new purchases while completing already pending settlement recovery.

## TQ connection

Uses CCP's public ESI directly; no account login or API key is required. EVE Market Browser has no documented public API that was identified in this research.

- `/markets/{region_id}/orders/?order_type=sell&type_id={type_id}` supplies station sell depth.
- `/markets/{region_id}/history/?type_id={type_id}` supplies seven completed days of volume and a historical price sanity check when available.
- `/markets/prices/` supplies CCP’s EVE average (`average_price`) when the selected hub has no valid sell orders. Industry `adjusted_price` is never used to pay a seller.

The reference averages the cheapest 5% of station sell depth. One valid order is sufficient; regional history checks plausibility when available. Missing, stale or implausible hub prices now continue to CCP’s positive, finite EVE average price. EVE average mode starts directly with that average. If no usable online reference exists, the final fallback reads the same native buy book and range rules as Sell → Immediate, at the item’s actual location. Only eligible seeded NPC bids are trusted; player bids cannot set the benchmark. Minimum-volume, available-quantity and pending-fill rules apply. The local value is the gross unit offer before sales tax; using it as a benchmark does not fill that buy order. The price ceiling and purchase chance still apply. My Orders labels the actual fallback **EVE average** or **Local NPC offer** under the generic **Reference price** column, and Sell Items labels it too. If every source fails, the UI says it cannot determine a fair price and pauses that item. Limited-mode quotas remain based on recent TQ volume; a local price does not invent demand. Unlimited mode needs no volume allowance. Online HTTP requests coalesce, honor ETags/Expires and back off on errors; local quotes are refreshed after 30 seconds and separated by actual station and offered quantity. The new derived-cache version ignores old rejected references without deleting saved state.

Official references: [ESI API explorer](https://developers.eveonline.com/api-explorer), [ESI best practices](https://developers.eveonline.com/docs/services/esi/best-practices/), [market-order rate limits](https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026).

## Real settlement

Purchases use EveJS's existing durable player-sell escrow saga, inventory custody, wallet authority, sales tax, history and order notifications. A native atomic expected-state guard checks the order's owner, corporation flag, item, station, price, remaining volume and source. Unknown outcomes retain the same operation identity and spending reservation across retries/restarts.

A persistent institution with no login account starts with zero ISK. Each purchase obtains only the funding it needs, with durable receipts to prevent duplicate payments. The funding cap applies only in Limited mode. Purchased goods remain in that institution's station hangars. This release models institutional demand; it does not create roaming NPC pilots or production chains.

## Verification and source

See `VERIFICATION.md` for the checks performed and remaining live-client coverage. JavaScript, Python client sources and corresponding native Rust source are included. The market daemon source derives from EveJS under AGPL-3.0; see `LICENSE`. Rebuild from `native/market-server` using `cargo build --release` with the matching Rust dependencies. Run `node build-payload.cjs` after rebuilding to package the executable and matching sources. No separate baseline installation is needed.
