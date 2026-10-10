# Contributing

Keep changes focused and describe the player-visible result. Include the checks you ran and distinguish isolated contracts from live EVE behaviour.

Run `npm test` and `python tools/check_source.py` before submitting a pull request. These checks need no server, account, API key or npm dependencies. See [Development](docs/DEVELOPMENT.md) for the optional native and client contracts.

Do not submit saves, local configuration, credentials, logs with account or character information, extracted EVE client modules or private reference material.

Preserve native settlement receipts and operation identities. Unknown outcomes must recover with the same keys. Do not disable file-hash guards or change the reviewed native payload without updating its matching source and installer checks.

New UI text must be translated in all eight catalogues. Run `python build-locales.py` after editing `client/locales.json`.
