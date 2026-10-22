# Current checkpoint — 2026-10-22

Active target: real iPod touch 4 / iOS 6.1.6 in Wasm, Safari and Pages with
Podium UI. No complete working browser iOS claimed.

Public Pages is live at https://agent-ios-dev.github.io/Podium-Web/ from prior
runtime 1e9d0f4; HEAD22a12df only adds private helper/report workflow changes.
Current uncommitted runtime adds OPFS import/reopen, real boot/frame/input,
original 384M virtual-units host clock pacing, minimum real button holds,
MessageChannel task scheduling and visible guest instruction counts.

Private Inferno-VM preparation run39824000586 succeeded. Fresh private kit in
../podium-web-private/fixture-artifact/private-podium-browser-fixture.tar.gz
is pristine (436924213 bytes), never publish it or keys/raw guest logs.
Native preparation helper c2a3c6f01beab9e2dd2f08b24ae92a0be141f72b matches
original Podium b8f54f55f33df3860c14ec134a416906f88348ad. No duplicate job needed.

Latest core built successfully in podium-web-build Docker with Swift6.2.4.
Node14 tests pass; Chromium and Windows mobile-WebKit UI/Wasm checks pass.
Windows WebKit lacks OPFS; actual iPhone Safari remains untested.
Actual kit streaming test: 8GiB logical, 776945664 stored root bytes, kernel
hash valid. Local Chromium imported kit and reopened OPFS after page reload.

Private controlled-guest.mjs Node session48253 keeps actual guest RAM and root
FD alive, now auto-paused after600sec: 9598190447 retired, no CPU halt,
749 nonblack frames, genuine Russian iOS6 lock screen visually inspected in
controlled-frame.png. No home screen/app claim. Control8097 only loopback.
IMPORTANT harness automatic600sec bound means resume immediately auto-pauses
again after one batch. A bounded3000 resume-batch + real swipe probe is running
session80636; do not launch a second copy on prepared/root.hfs. Old root is
modified by boot; archive remains pristine. Do not stop unrelated Inferno VM.

Browser CUA page tab2 local8096 now has independent OPFS copy, latest pacing
core and MessageChannel worker, actual guest running, counter visible. It was
cold-restarted after host flush to test saved storage and updated scheduler.
Keep it open. No browser image UI yet at this checkpoint. Public tab4 remains
old Pages prototype. Do not replace any genuine output with screenshot/logo.

Next: inspect bounded Node unlock result and actual browser frame/input.
Only commit source/tests/bounded reports. Never private firmware, images,
keys, raw logs. Save actual screenshot evidence locally. Publish current code
only after final browser checks, retain clear unverified Safari/app limits.
