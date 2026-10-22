#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 tools/prepare.py
swift build -c release --swift-sdk swift-6.2.4-RELEASE_wasm \
  -Xlinker --export=podium_create -Xlinker --export=podium_write32 \
  -Xlinker --export=podium_read32 -Xlinker --export=podium_register \
  -Xlinker --export=podium_set_register -Xlinker --export=podium_run \
  -Xlinker --export=podium_thumb -Xlinker --export=podium_cpsr \
  -Xlinker --export=podium_allocate -Xlinker --export=podium_release \
  -Xlinker --export=podium_boot -Xlinker --export=podium_machine_run \
  -Xlinker --export=podium_machine_pc -Xlinker --export=podium_frame \
  -Xlinker --export=podium_button -Xlinker --export=podium_touch -Xlinker --export=podium_flush \
  -Xlinker --export=podium_hardware_test -Xlinker --export=podium_aes_test \
  -Xlinker --export=podium_kernel_probe -Xlinker --export=podium_storage_test
mkdir -p web
cp .build/wasm32-unknown-wasip1/release/podium-core.wasm web/core.wasm
