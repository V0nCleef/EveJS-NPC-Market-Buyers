# Private NPC Market Buyers 0.1.29 compatibility candidate

Targets EveJS 261126.2 and 261125.3, retaining prior 261115.2 support. This
candidate derives from public base 4502e0841d27ed4e58d4498aad52cf64a809dcad and
the preceding private 0.1.28 stock candidate. No publication or user-save change.

A real 0.1.28 sale on 261126.2 settled money but recorded corporation history
using the corporation as the issuing pilot and legacy wallet account fields.
0.1.29 uses the new stock wallet-account helper for newly created corporation
history, after validating its exact reviewed source seam. Existing durable
outbox payloads retain their bytes, command keys and owner fingerprints. Prior
history is not rewritten. The exact 0.1.28 financial predecessor is retained for
enabled updates. Unknown sources and pending-settlement disable remain blocked.

Windows Native proofs cover personal/corporation placement, custody, money,
escrow/tax and exactly-once cold replay at buyer-debit, seller-credit, tax-debit
and daemon-fill lost acknowledgements. Persisted corporation rows identify the
issuing pilot and both wallet accounts. Five real synthetic runs cover the new
target and preserved .3/261115.2 controls. Focused suites pass 117 checks on each
of .2 and .3, including exact predecessor/pending-payload preservation.

All 18 pristine stock Market compiler files are byte-identical between .3 and
.2; dependencies are also unchanged. The Windows EXE, modern Linux ELF and
legacy Linux ELF are reused byte-for-byte. The modern ELF metadata now binds
both exact reviewed versions. All compiler, source, executable, permission,
image and archive guards remain. Linux lifecycle checks cover both selectors,
unknown-input refusal, interruption, restoration and pending enabled updates.
The prior locked Rust tests apply to the unchanged compiler inputs and binary;
no rebuild was necessary. Shared-source folder names retain 2611253 provenance.

The accompanying immutable private receipt records final Linux Native/Docker
runtime results, owner-lease failures and enabled-update adoption status. The
approved isolated QA environment still exhibits >102-second wall-clock jumps
and reversals within approximately 250 ms monotonic intervals. Owner leases
remain at their stock values; no clock or financial guard is bypassed. Passing
focused runs do not establish a soak or prove environment-wide stability.

World schema is 35 on .2/.3 and 0 on the older control. Market manifest schema
is 1, with unchanged reviewed Market table definitions. Fixtures use invented
actors and small selected references. No retail client/GUI/GPU, personal world,
Docker Desktop, public repository, release or Discord changes occur here.
Retail 3724492 gameplay, Proton/Steam Deck, full scale and production GUI/Compose
adoption still require separate acceptance. Historical orphan recovery on the
new hosts is deliberately excluded from its exact-hash allowlist.
