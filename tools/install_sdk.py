"""Install the matching official Swift SDK in the isolated build container."""
import hashlib
import pathlib
import subprocess
import urllib.request

version = '6.2.4'
archive = pathlib.Path('/tmp/swift-wasm.tar.gz')
url = f'https://download.swift.org/swift-{version}-release/wasm-sdk/swift-{version}-RELEASE/swift-{version}-RELEASE_wasm.artifactbundle.tar.gz'
print('Downloading', url, flush=True)
if not archive.exists():
    urllib.request.urlretrieve(url, archive)
digest = hashlib.sha256()
with archive.open('rb') as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b''):
        digest.update(chunk)
print('SHA256', digest.hexdigest(), flush=True)
if digest.hexdigest() != '32fdb8772d73bb174f77b5c59bc88a0d55003d75712832129394d3465158fb43':
    raise RuntimeError('SDK archive changed; refusing to install')
subprocess.run(['swift', 'sdk', 'install', str(archive)], check=True)
