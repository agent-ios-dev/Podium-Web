"""Pin an already verified runtime so UI-only rebuilds retain snapshot compatibility."""
from pathlib import Path
import hashlib,json,urllib.request
root=Path(__file__).resolve().parent.parent
pin=json.loads((root/'runtime.json').read_text())
h=hashlib.sha256()
for path in pin['sourceFiles']:
    h.update(path.encode()+b'\0'+(root/path).read_bytes().replace(b'\r\n',b'\n')+b'\0')
if h.hexdigest()!=pin['sourceSha256']:
    raise SystemExit('Core source inputs changed: publish and pin a verified runtime before deployment.')
with urllib.request.urlopen(pin['url'],timeout=120) as response:
    data=response.read()
if hashlib.sha256(data).hexdigest()!=pin['sha256']:
    raise SystemExit('Pinned runtime checksum mismatch')
target=root/'web/core.wasm'
temporary=target.with_suffix('.wasm.download')
temporary.write_bytes(data)
temporary.replace(target)
print('Snapshot-compatible runtime verified: '+pin['sha256'])
