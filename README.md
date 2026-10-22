# Podium Web

Browser/WebAssembly port of Podium's real ARMv7 interpreter, targeting iPod
touch 4 / iOS 6.1.6. This is an unfinished emulator port, not a working iOS
release. No firmware, disks, keys, or guest screenshots are published here.

## Current evidence

- Original ARM/Thumb fetch/decode/execute code compiled with Swift 6.2.4 to Wasm.
- Nine Node WASI semantic checks pass (arithmetic, condition flags, branching,
  guest memory, Thumb, invalid input boundaries, actual A4 timer/IRQ/MMIO,
  independent FIPS AES vector and invalid boot arguments).
- Three guest instruction checks also pass in the browser's WASI shim.
- The original iOS 6.1.6 kernel + original n81ap device tree executed
  100 million instructions in a private, read-only Wasm kernel probe with no
  observed CPU halt. No root disk was attached: this is not a full iOS boot.
- Home, Settings, Firmware, emulator and Developer Console layouts follow the
  original SwiftUI screen hierarchy. Unsupported guest controls are disabled.
- Navigation, theme changes, actual Wasm execution, benchmark and stop pass in
  Chromium and Playwright's mobile WebKit configuration. This does **not** prove
  physical iPhone Safari behavior, iOS boot, application launch or guest graphics.
- Chromium passed a real Wasm→OPFS write/flush/read/close/reopen roundtrip on its
  own temporary 16-byte file. Windows WebKit does not expose the OPFS API; the
  site reports that limitation explicitly. Persistence on iPhone is unverified.

## Build and run

Keep the pinned upstream Podium checkout beside this project, named `Podium`.
Use Swift 6.2.4 and its matching official Wasm SDK, then:

```sh
python3 tools/install_sdk.py
sh tools/build.sh
npm ci --ignore-scripts
node tools/vendor.mjs
npm test
npm start
```

Open http://127.0.0.1:8096. The generated `web/` folder is static and can be
served under a GitHub Pages project subpath. All URLs are relative. Module
Workers and WebAssembly are required. No SharedArrayBuffer, browser extension,
StikDebug, remote VM or cross-origin isolation is required for this single-worker
interpreter. Fullscreen uses an in-page layout on iPhone.

The `pages` workflow builds the module, tests WebKit/Chromium, and publishes only
after the checks pass. It never publishes the source checkout or private images.

## Next boot blockers

The A4 platform, Mach-O loader, boot arguments and display scanout now compile
for Wasm. AES uses CryptoSwift instead of CommonCrypto. The exact-kernel disk
bridge uses bounded 64-bit host callbacks intended for a Worker OPFS handle.
These build results do not prove guest boot or graphics. Complete and verify
disk access/persistence suitable for Safari, import and
prepare firmware locally, connect real scanout and touch/button input. Verify
the original kernel, lock/home screens and repeated app launches before marking
this emulator usable. CPU benchmarks are not system boot evidence.

Upstream: https://github.com/Leviidev/Podium at
`b8f54f55f33df3860c14ec134a416906f88348ad`.
The preparation tool records SHA-256 for source inputs and limits adaptations
to explicit browser adapters. Third-party runtime licenses are in `web/vendor/`.
