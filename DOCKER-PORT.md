# Private Docker candidate

Unpublished candidate based on NPC Market Buyers 0.1.23. The proposed version is 0.1.24; no tag or public release has been created. Requires the Launcher 1.0.80 candidate, EveJS 261108.1 and Linux amd64. Native installers, update validation and default state paths remain intact.

The manifest declares the `cargo-release-v1` market contribution. The Launcher builds the locked Rust source on its captured base image, owns image application/rollback and attests the selected market image. The mod helper never stops services or chooses a different Compose project. Docker state persists below `EVEJS_MOD_DATA_ROOT/npc-market-buyers`, normally `/var/lib/evejs/mods/npc-market-buyers`; the package can be mounted read-only.

Prestart requires `runtime.market.imageId` and `runtime.market.expectedImageId`, both the same Root-captured `sha256:` identity. It prepares an installation-bound nonce without connecting to the stopped market. Actual loader readiness then validates the live daemon capabilities and its absolute database path inside the selected data mount. Historical recovery additionally checks the configured endpoint, live DNS/socket peer, fresh nonce and matching physical database. Native loopback protections remain unchanged.

Pending transactions block real disable/removal. Docker update prepare/apply/commit/rollback preserves settlement data and exact prior receipts, supports retry after interruption and returns `recovery-required` when the Launcher image decision is unresolved. It never discards pending rows, history, wallet intents or custody receipts.

Verified in isolation: 31 Linux Rust tests; actual Buyers loader startup; real market, wallet-authority process, personal/corporation sales, taxes, custody and history; deterministic random/offline scheduling; lost daemon/wallet acknowledgements and exactly-once replay across recreated containers. Eight Linux lifecycle cases and 19 Native installer cases pass. The six core financial files match the original release byte for byte.

Combined Launcher image/lifecycle, common login runtime, retail-client acknowledgement, UI and package acceptance belong to the consolidation pass. No live installation has been changed.
