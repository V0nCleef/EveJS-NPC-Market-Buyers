# NPC Market Buyers 0.1.25 — verification

## Qualified target

Windows Native on EveJS 261115.2, with the existing packaged market executable and Launcher 1.0.80 or newer. No new Docker/Linux runtime qualification is claimed.

## Completed checks

- 132 Node checks against the actual target source, covering wallet command identity, corporation idempotency and refund metadata, pending-work preservation, guarded updates and rollback, settlement, persistence and shared login delivery.
- Source, localisation, Python 2 grammar, JavaScript and packaged native-source checks, plus six package/update-metadata contracts.
- Real native personal and corporation purchases using the native wallet authority, market daemon and custody APIs; random/offline scheduling and cold recovery after lost replies.
- Eighteen historical orphan-recovery controls, including all four interrupted effects, restart/replay, unsupported-source refusal and unchanged original inputs. Private saved-game data and diagnostic receipts are not release assets.
- Actual Launcher update into a separate installation root, preserving settings, history, pending work and rollback material.
- Actual GridCheck purchase and cold replay, including a focused replay on the exact packaged executable with real lifecycle verification before and after startup.
- Actual retail Orders, Statistics, Activity, native Sell Items advisor and shared Mods menu in the combined native world. The coordinator also accepted the same-world retail reconnect and unchanged financial fingerprint.

Deterministic price, clock and random inputs were used where identified by the isolated test cases. These checks do not establish external price-feed behaviour or every gameplay feature of other mods. The initial GridCheck-managed build produced a different local executable; the separate exact-packaged-executable replay closed that artifact gap without changing any receipt or allowlist.

## Remaining limits

Docker source adaptation and lifecycle checks ran in simulated host fixtures. A new-version Linux image/runtime run was not performed. Existing source guards and pending-settlement protection remain in force; do not delete receipts or history to force an update.
