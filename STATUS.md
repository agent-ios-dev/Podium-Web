# Checkpoint — 22 October 2026

Goal: genuine iPod touch 4 / iOS 6.1.6 running entirely in Safari via Wasm, with
Podium's native app UI hierarchy, published on GitHub Pages. NOT achieved yet.

Current project work/Podium-Web, new repo agent-ios-dev/Podium-Web. First Actions
run 39821367430 builds pinned upstream sources and publishes ONLY static web/.
Pages enabled at https://agent-ios-dev.github.io/Podium-Web/; confirm deployment.

Actual local results: Swift6.2.4 official Wasm SDK checksum recorded; 63 upstream
Swift files include ARM/Thumb/MMU, A4 platform, kernel loader and scanout. Native
AArch64 JIT explicitly unavailable; no fake native code. AES adapted to pinned
CryptoSwift1.8.4 with actual FIPS encrypt/decrypt vector passing. Nine Node WASI
checks passed. Actual UI/browser execution tests passed Chromium + Windows
Playwright WebKit26 with iPhone13 viewport. This is not physical Safari evidence.

Original kernel work/kernel.macho SHA matches original 10B500 storage ABI.
Original n81ap device tree fetched by HTTP Range from official Apple IPSW into
PRIVATE sibling work/podium-web-private/devicetree.bin. Read-only kernel probe
runs **100,000,000** actual guest instructions, no observed CPU error or stop
breakpoint. NO root disk attached; no userspace, SpringBoard, app or visible UI
proof. Never publish private tree/kernel/key material or raw logs. Public report
contains only bounded result. Private harness kernel-probe.mjs and result there.

Current local build container podium-web-build, Swift6.2-jammy actually6.2.4;
source/SDK build in it. work/Podium original is read-only by convention, no
original emulator/VM changes. Native inferno VM left alone. Local server Node
session serves http://127.0.0.1:8096. Last build session31961 adds an exported
Wasm OPFS roundtrip probe using a unique temporary16bytefile. Wait for completion
then npm test and npx playwright test (WebKit+Chromium). The new browser test
expects5checks (ARM memory/branch/Thumb, A4 IRQ, AES) and OPFS flush/reopen proof.
Do not claim that storage check passed until it does. Remove stale COOP/COEP
headers by restarting local server before final tests: Pages has neither header.

Source changes after initial7e85b83 include real-kernel-probe export, OPFS test,
source attribution/licenses, SVG icon fixes and bounded100M report. Commit/push
ONLY after passing. Don't launch duplicate Actions; existing run may be active.

Missing: usable root image/firmware preparation and import (IPSW button still
disabled), persisted OPFS guest disk + boot loop wiring/frame transfer/touch in
Worker/UI. Swift BrowserMachine has a genuine original disk-bridge adapter with
64bitoffset imports; Worker host callbacks validate bounds but only the temporary
OPFS probe opens a handle so far. Don't imply full8GiB guest I/O is verified.
Firmware import requires porting UDIF encrypted image / HFS preparation (original
Swift sources in Podium/Firmware/RootFilesystem; Apple-only Compression,
CommonCrypto, Darwin, SQLite etc). Existing old prepared iPod image not found in
workspace; D drive absent. DO NOT substitute iPhone11/Inferno disk or pretend
an empty sparse disk is a real iOS root. Source key file is only read locally by
private fetch helper; do not copy it into public port.

UI: Home, Settings, Firmware, Emulator, Developer from original SwiftUI source.
Theme+case toggles functional, unsupported iOS/disk/audio/install controls
explicitly disabled. No fake guest screenshot/Apple boot animation. User requested
actual iOS with graphical interface, not CPU-only demo; remain clear unfinished.
