# NPC Market Buyers 0.1.26 verification

Target: EveJS 261115.2. Windows uses the unchanged packaged Market executable and requires Launcher 1.0.80 or newer. Native Linux x86_64 requires Launcher 1.0.87 and the separately compiled ELF payload.

The Linux payload was built from this package's locked Rust source and compiler-input inventory. Its metadata binds the executable, patched sources, dependencies and target version. The launcher checks that binding before selecting the executable. Windows payload bytes remain unchanged.

Checks on isolated Windows and Linux installations cover install, verification, recovery, removal, source and executable tamper refusal, permissions, enabled updates and rollback. Production launcher import/update checks preserve pending settlement rows. Real native Market daemons exercise conditional fills, duplicate replay and cold restart, with one fill receipt and intact SQLite data. Linux checks run as an ordinary user in a disposable container with no published host ports.

The Windows predecessor is the actual published 0.1.25 archive. There was no published native Linux 0.1.25: the Linux predecessor is an explicitly synthetic first-port fixture using a different real compiled ELF. Candidate downloads are injected locally; these packages have not been published.

This port does not repeat the prior release's retail-client, wallet and custody gameplay qualification. No current real EVE/Proton gameplay, Steam Deck hardware, or complete Docker game stack qualification is claimed. Historical version fixtures and pinned third-party coexistence fixtures are outside the current-target regression selection. Keep source guards, financial history and pending-settlement protection intact.
