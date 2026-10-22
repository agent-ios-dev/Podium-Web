import {cp,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('web/vendor/',root),{recursive:true});
await cp(new URL('node_modules/@bjorn3/browser_wasi_shim/dist/',root),new URL('web/vendor/',root),{recursive:true});
for (const file of ['LICENSE-MIT','LICENSE-APACHE'])
  await cp(new URL(`node_modules/@bjorn3/browser_wasi_shim/${file}`,root),new URL(`web/vendor/${file}`,root));
