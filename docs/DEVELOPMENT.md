# Development

The runtime is JavaScript with a Python 2 compatible EVE client companion. The included Rust daemon adds a conditional market-fill guard. The mod uses the existing EveJS wallet, inventory and sell-order settlement paths.

## Portable checks

Use Node.js 22 or newer and Python 3.12. No npm install is needed.

```sh
npm test
python tools/check_source.py
python -B tests/update_package_tests.py
```

The first command runs the existing pricing, reference/fallback and policy tests with simulated HTTP data. The second checks catalogue completeness, matching embedded translations, Python syntax/grammar, JavaScript syntax, metadata and matching packaged native source. The third builds a disposable ZIP and checks its matching update sidecar, including rejected legacy packages and wrong asset names. GitHub Actions runs these checks; it does not run an EVE client or native purchase stack.

## Native integration checks

Provide your own EveJS installation (tested with 0.12.9) and Launcher checkout. Install that server's dependencies normally. Its AutoMining 1.2.0 package is used by the existing delivery composition contract.

```powershell
$env:EVEJS_TEST_ROOT = 'D:\EveJS-v0.12.9'
$env:EVEJS_LAUNCHER_ROOT = 'D:\evejs-launcher'
npm run test:native
python -B tests/launcher_update_tests.py
```

The tests use isolated databases and simulated transports where stated. They do not start your live stack. `tests/market-integration.js` is a separate deeper fixture that starts an isolated native market process; review that harness and its environment first.

The authored Python client contracts require private reference modules from a client you already have. Those modules are deliberately excluded from this repository.

```powershell
$env:EVEJS_CLIENT_REFERENCE_DIR = 'D:\private-reference\client-source'
$env:EVEJS_WALLET_REFERENCE_DIR = 'D:\private-reference\wallet-source'
python -B tests/client_tests.py
python -B tests/wallet_client_tests.py
```

Do not upload the reference directories. Contract coverage is not live rendering, actual Python 2 execution or gameplay acceptance.

## Isolated visual testing with GridCheck

The local harness in `tools/stage-gridcheck.cjs` deliberately accepts only the disposable playground, never the live play tree. It backs up modified test files and hashes nine protected live files before staging the candidate. `tools/gridcheck-fixture-loader.cjs` exposes a fixture RPC only in that test tree and for its dedicated test character. These test tools are excluded from Launcher ZIPs.

The fixture creates ten actual sell orders and completes ten native purchases. It adds 12,000 clearly marked historical accounting entries separately; those synthetic entries do not credit a wallet. Reusing a fixture requires keeping its world, market database and mod database together. Do not run the seed a second time against the same world.

`python tools/make-gridcheck-scenario.py` writes `tests/gridcheck/statistics.json`. Validate it with `gridcheck run <path> --check`, then run it against the already populated isolated world in auto/attach mode. Let the test client finish loading its station first: the scenario refuses visual checks while its loading screen is visible. The scenario opens the normal mod window through `owner.open_window()`, validates receipt totals, measures Statistics RPCs, checks archive paging and custom days, and captures ten actual client screenshots. GridCheck's test client does not need the Launcher Mods menu to open this window.

The test world must remain separate in data, native market and ports. Close the test client and stop its managed stack after testing or review. Never stop the player's live stack to run this scenario.

## Build a Launcher ZIP

```sh
python build-locales.py
python tools/check_source.py
python pack-release.py
```

Output goes to `dist/`: an installable `NPC-Market-Buyers-{version}.zip`, a matching `.update.json` sidecar, and a local build receipt. Attach **both the ZIP and sidecar** to the same stable GitHub release tagged `v{version}`. The sidecar is derived from the finished ZIP's manifest; never hand-edit it. Users import only the ZIP. Packaging uses the included payload; it does not compile Rust or touch a live server. Rebuilt ZIP containers and repository documentation can differ from the original reviewed release asset. The published 0.1.17 asset's SHA-256 is recorded in [release metadata](../releases/0.1.17.json).

The Launcher integration test requires a finished ZIP in `dist/` and the two environment paths above. It reads the supplied server files without requiring baseline hashes and creates disposable, stopped fixtures under `.test-runtime/`. It exercises the actual Launcher checker, downloader, enabled/disabled replacement and failed-activation rollback. Its older package is explicitly synthetic: it has update support so the replacement path can be tested. Real 0.1.16 and earlier packages require manual import. Set `EVEJS_PREVIOUS_PACKAGE` to an original older ZIP to also test that one-time import with the actual legacy package. No game or market process is started. With `--hosted`, the test also checks the public GitHub feed and downloaded digest after publication.

To change the native daemon, build from `native/market-server` with `cargo build --release --locked`, then run `node build-payload.cjs`. The payload contains the executable and corresponding source without baseline hashes. Native source and executable must stay in sync.
