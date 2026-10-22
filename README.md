# Podium Web

Browser/WebAssembly port of Podium's real ARMv7 interpreter, targeting iPod
touch 4 / iOS 6.1.6. This is an unfinished emulator port, not a working iOS
release. No firmware, disks, keys, or guest screenshots are published here.

## Current evidence

- Original ARM/Thumb fetch/decode/execute code compiled with Swift 6.2.4 to Wasm.
- Nine Node WASI semantic checks pass (arithmetic, condition flags, branching,
  guest memory, Thumb, invalid input boundaries, actual A4 timer/IRQ/MMIO,
  independent FIPS AES vector and invalid boot arguments).
- Five CPU, hardware and AES checks also pass in the browser WASI shim.
- Five additional archive tests cover sparse extents, path rejection, overlap,
  truncation and checksum errors (14 Node tests total).
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

## Prepared guest import

The Firmware screen accepts a private prepared `.tar.gz` kit containing
`manifest.json`, `kernel.macho`, `devicetree.bin`, and `root.hfs`. It also accepts
the three raw boot/disk files together. The exact original iPod4,1 / 10B500
kernel and HFS geometry are validated before boot. IPSW preparation in the
browser is unfinished; the private preparation workflow uses the pinned
upstream recipe and does not publish guest files.

The gzip/tar importer streams GNU sparse 1.0 extents directly to Worker OPFS.
It does not expand the 8 GiB disk in RAM. An actual private kit was imported
in local Chromium, flushed and reopened after a page reload. This is a browser
origin-local disk: localhost and GitHub Pages have separate storage.

Power On executes the real guest, transfers actual scanout pixels to canvas,
and forwards pointer input and Home/Power/volume buttons to A4 devices. Pause
retains RAM and flushes host writes; it is not a guest filesystem shutdown.
Keep the tab open to preserve paused RAM. Reload performs a new cold boot.

A private Node WASI run of this same core with the prepared disk reached a
visible genuine iOS 6 lock screen after the original host/virtual clock pacing
was restored. This establishes guest graphics in the Node harness, **not**
browser SpringBoard, functional apps or physical iPhone Safari compatibility.
The full browser guest test is in progress; no usable iOS release is claimed.

## Remaining boot validation

The A4 platform, Mach-O loader, boot arguments and display scanout now compile
for Wasm. AES uses CryptoSwift instead of CommonCrypto. The exact-kernel disk
bridge uses bounded 64-bit host callbacks intended for a Worker OPFS handle.
These build results do not prove guest boot or graphics. Verify
disk access/persistence suitable for physical Safari, finish browser IPSW
preparation and validate scanout plus touch/button input end to end. Verify
the original kernel, lock/home screens and repeated app launches before marking
this emulator usable. CPU benchmarks are not system boot evidence.

Upstream: https://github.com/Leviidev/Podium at
`b8f54f55f33df3860c14ec134a416906f88348ad`.
The preparation tool records SHA-256 for source inputs and limits adaptations
to explicit browser adapters. Third-party runtime licenses are in `web/vendor/`.

## Manual backups and paused-state files

In Settings → Virtual iPod:

- **Сохранить диск в файл** exports the current disk plus kernel/device tree.
  Importing this backup cold-boots the disk; it does not resume paused CPU state.
  Saving a mounted disk is crash-consistent, not a clean iOS shutdown.
- **Пауза и сохранить полный снимок** pauses at a Wasm call boundary and exports
  the matching disk plus the complete Wasm linear memory. CPU state, device
  objects, guest RAM and Swift heap are inside this image. The monotonic clock
  offset is restored as well. The guest stays paused when saving finishes.
- Click **Скачать готовый файл** to download `.podiumvm.gz` to your device.
- **Восстановить из файла** validates and stages a backup into a new OPFS
  directory before replacing the active disk pointer. A full snapshot opens
  paused: choose Launch iPod → Resume to continue. The previous disk directory
  is retained. Do not reload while a save or restore operation is in progress.

Full snapshots require exactly the same `core.wasm` SHA-256. An incompatible
core is rejected before memory restoration; retain the corresponding runtime
version when updating. These files contain private guest data and stay local.
Sparse blocks and gzip are streamed without allocating the full disk in RAM.
Storage quota is checked conservatively; enough room for a separate disk and
staged memory is required. Physical iPhone Safari remains unverified.
