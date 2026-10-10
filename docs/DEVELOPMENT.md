# Development

The runtime is JavaScript with a Python 2 compatible EVE client companion. The included Rust daemon adds a conditional market-fill guard. The mod uses the existing EveJS wallet, inventory and sell-order settlement paths.

## Portable checks

Use Node.js 22 or newer and Python 3.12. No npm install is needed.

```sh
npm test
python tools/check_source.py
```

The first command runs the existing pricing, reference/fallback and policy tests with simulated HTTP data. The second checks catalogue completeness, matching embedded translations, Python syntax/grammar, JavaScript syntax, metadata and the reviewed payload hashes. GitHub Actions runs these checks; it does not run an EVE client or native purchase stack.

## Native integration checks

Provide your own reviewed EveJS 0.12.9 installation and Launcher checkout. Install that server's dependencies normally. Its AutoMining 1.2.0 package is used by the existing delivery composition contract.

```powershell
$env:EVEJS_TEST_ROOT = 'D:\EveJS-v0.12.9'
$env:EVEJS_LAUNCHER_ROOT = 'D:\evejs-launcher'
npm run test:native
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

## Build a Launcher ZIP

```sh
python build-locales.py
python tools/check_source.py
python pack-release.py
```

Output goes to `dist/`. Packaging uses the included reviewed payload; it does not compile Rust or touch a live server. Rebuilt ZIP containers and repository documentation can differ from the original reviewed release asset. The draft 0.1.15 asset retains its original SHA-256 in [release metadata](releases/0.1.15.json).

To change the native daemon, build from `native/market-server` with `cargo build --release --locked`. Regenerate the payload only against a separate clean reviewed EveJS baseline. `build-payload.cjs` records baseline hashes; pointing it at an already patched live installation would produce invalid baseline guards. Native source and executable must stay in sync.
