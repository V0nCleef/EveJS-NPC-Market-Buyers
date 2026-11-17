# Native Linux support

NPC Market Buyers 0.1.26 includes both Windows and native x86_64 Linux Market
payloads in one ZIP. Windows requirements and financial behavior are retained.
Native Linux support targets EveJS 261115.2 and requires Launcher 1.0.87 or newer.
An older Linux launcher is refused before native files are changed.

Use the Launcher to install, enable, update, recover, disable or remove the mod.
The Linux installer selects the ELF executable, preserves original files and
permissions, and records the binary and exact compiler inputs. The Launcher
checks that receipt and starts that binary for the selected installation.
Unknown file changes, unsupported builds and unfinished transactions remain
blocked. Source repair and rollback retain the original uninstall backups.

Purchase history, settings and settlement receipts remain outside the replaceable
package. Enabled updates retain pending settlement work; disabling and removal
still require that work to finish through normal recovery. No settlement guard
is bypassed and no financial journal is deleted by the installer.

The Linux executable is built on Debian Bookworm with glibc and locked Cargo
dependencies. Actual EVE/Proton gameplay and SteamOS hardware still require
separate qualification; daemon and helper tests do not establish client gameplay.
