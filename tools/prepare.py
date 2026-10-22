"""Copy the real Podium ARM interpreter; keep original project unchanged."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
source = root.parent / 'Podium'
emu = source / 'Podium/Emulator'
destination = root / 'Sources/Upstream'
destination.mkdir(parents=True, exist_ok=True)
files = [*sorted((emu / 'CPU/ARMv7').glob('*.swift')), emu / 'CPU/CPU.swift',
         emu / 'Memory/MemoryBus.swift', emu / 'Memory/MemoryAccessError.swift']
for folder in ['Platform', 'Timers', 'Interrupts', 'Boot', 'Acceleration', 'Display']:
    files.extend(sorted((emu / folder).glob('*.swift')))
files.extend([emu / 'Memory/SegmentedMemoryBus.swift', emu / 'Memory/MMIORegion.swift',
              emu / 'Input/InputEvent.swift',
              emu / 'GuestAccommodations.swift', emu / 'Storage/GuestDiskBridge.swift',
              source / 'Podium/Firmware/Boot/DeviceTreePatcher.swift',
              source / 'Podium/Firmware/Boot/DeviceTreeMemoryMap.swift',
              source / 'Podium/Shared/PodiumError.swift', source / 'Podium/Shared/DataByteReading.swift',
              source / 'Podium/Shared/HexEncoding.swift'])
manifest = {'upstream_commit': subprocess.check_output(['git', '-c', f'safe.directory={source}', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(), 'files': {}}
for path in files:
    shutil.copyfile(path, destination / path.name)
    manifest['files'][str(path.relative_to(source))] = hashlib.sha256(path.read_bytes()).hexdigest()
# CommonCrypto is an Apple platform module. Preserve the device register/DMA
# implementation and replace only its whole-block AES host operation.
aes = destination / 'S5L8930XCDMA.swift'
text = aes.read_text().replace('import CommonCrypto', 'import CryptoSwift')
start = text.index('        var output = Data(count: length)', text.index('    static func aes('))
end = text.index('        return output + input.suffix(from: length)', start)
text = text[:start] + '''        let mode: BlockMode = cbc ? CBC(iv: iv) : ECB()
        guard let cipher = try? AES(key: key, blockMode: mode, padding: .noPadding),
              let bytes = try? (encrypt ? cipher.encrypt(Array(input.prefix(length))) : cipher.decrypt(Array(input.prefix(length)))) else {
            preconditionFailure("AES device host operation failed")
        }
        let output = Data(bytes)
''' + text[end:]
aes.write_text(text)
disk = destination / 'GuestDiskBridge.swift'
disk.write_text(disk.read_text().replace('import CryptoKit', 'import CryptoSwift').replace('import Darwin', 'import WASILibc').replace('SHA256.hash(data: original).hexEncodedString', 'Digest.sha256(Array(original)).toHexString()'))
(root / 'upstream-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Prepared {len(files)} upstream Swift files; explicit AES and disk hashing adaptations applied')
