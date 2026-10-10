# Verification — NPC Market Buyers 0.1.15

My Orders bars show remaining quantity divided by original quantity. Full means all listed stock is still for sale; the bar drains as stock sells. Existing Details and Icons bars share this meaning. The Details caption and help popup match it in all eight languages. List retains its numeric quantity columns. Unknown original quantities retain their unavailable explanation.

## Checked

- Eight existing client checks pass: original/remaining quantities and unavailable originals, all three order views, native icon wrapping, and the five language/catalogue contracts. All 226 authored strings have complete matching placeholders across eight languages.
- Login delivery composition is checked against the actual native codec, AutoMining and the Launcher shared Mods wrappers.
- Python 2 grammar and host compilation cover all six client files.
- Real Launcher ZIP import and install/verify/prepare/disable helpers run in isolation. Package audits verify exact source correspondence and the unchanged five-file native payload.
- All server JavaScript, pricing, purchase scheduling, financial settlement, offline summaries and Wallet formatter code are byte-for-byte unchanged from 0.1.14. No Rust rebuild is needed.

## Limits

This is a client display change. Live EVE rendering and actual Python 2 execution are not exercised by the isolated contracts. Reconnect EVE after updating to load the new bar direction, caption and help text. Settings, purchase history and native game/market state are preserved.

## Maintainer approval

On 10 October 2026, the maintainer reported testing the installed 0.1.15 update in game and approved it, with a gameplay recording supplied for the showcase. This user acceptance is separate from the automated checks above. The third edited showcase cut then received separate approval, followed by an explicit request to publish 0.1.15.

The approved showcase is 2560 × 1440 at 30 fps, with LYRA narration and captions. Its complete decode passed, and sampled frames from the opening and pricing explanations were reviewed. The published video matches that approved local file; it is an edited walkthrough, rather than additional automated gameplay coverage.
