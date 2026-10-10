# Releasing

1. Validate the exact candidate ZIP through the real Launcher's import/install/verify/disable lifecycle in isolation.
2. Test the candidate in game, including order bars, sell advice, buying, Wallet descriptions and offline catch-up. Record unperformed coverage honestly.
3. Prepare a draft GitHub release targeting the reviewed commit. Attach the Launcher ZIP and `SHA256SUMS.txt`; compare the uploaded asset with the local reviewed bytes.
4. Publish only after the maintainer approves the candidate. Do not enable automatic publication from a push or tag.

The initial 0.1.15 update, third showcase cut and public release received the maintainer's separate approvals on 10 October 2026. Keep future releases as drafts until approved. Any future edited video also needs separate approval before upload, including to a draft release.

Never upload game/server databases, backups, private client reference modules or local account/configuration files. GitHub's automatic Source code archives are for development, not Launcher installation.
