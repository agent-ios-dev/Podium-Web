import {WASI, File, OpenFile, ConsoleStdout} from './vendor/index.js';
import {readFixtureTar} from './tar-stream.js';
import {encodeArchive,decodeArchive} from './vm-archive.js';
let coreHash,clockOffsetMs=0,archiveBusy=false;
let core, diskHandle, bootFiles, guestRunning=false, guestCreated=false, frameNumber=0;
const send = (type, data) => postMessage({type,...data});
async function load() {
  if(core)return;
  const wasi = new WASI(['podium-core'], [], [new OpenFile(new File([])),
    ConsoleStdout.lineBuffered(text=>send('log',{text})),
    ConsoleStdout.lineBuffered(text=>send('log',{text}))]);
  const response = await fetch('./core.wasm');
  if (!response.ok) throw new Error('Ядро core.wasm отсутствует. Выполните сборку.');
  const wasmBytes=await response.arrayBuffer();
  coreHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wasmBytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const module = await WebAssembly.compile(wasmBytes);
  const clockGet=wasi.wasiImport.clock_time_get;
  wasi.wasiImport.clock_time_get=(id,precision,pointer)=>{
    if(id!==1)return clockGet(id,precision,pointer);
    new DataView(instance.exports.memory.buffer).setBigUint64(pointer,BigInt(Math.round((performance.now()+clockOffsetMs)*1e6)),true);return 0;
  };
  const host = {
    disk_size:()=>BigInt(diskHandle?.getSize() ?? 0),
    disk_read:(offset,pointer,length)=>diskIO(false,offset,pointer,length),
    disk_write:(offset,pointer,length)=>diskIO(true,offset,pointer,length),
    disk_flush:()=>{try{if(!diskHandle)return -1;diskHandle.flush();return 0;}catch{return -1;}}
  };
  const instance = await WebAssembly.instantiate(module,{wasi_snapshot_preview1:wasi.wasiImport,podium_host:host});
  const exit = wasi.start(instance);
  if (exit !== 0) throw new Error(`WASI startup failed: ${exit}`);
  core = instance.exports;
  send('ready',{bytes:(await fetch('./core.wasm',{method:'HEAD'})).headers.get('content-length')});
}
const kernelHash='415717e559c48fcf8a2aedec05d3ed2efa6312b11de942acd1c56629b72192ef';
async function checkedBootFiles(kernel,tree) {
  if(!kernel || !tree || kernel.size>64*1024*1024 || kernel.size<1024 || tree.size>1024*1024 || tree.size<100)throw new Error('Invalid prepared kernel/device tree files');
  const bytes=await kernel.arrayBuffer(),dt=await tree.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==kernelHash)throw new Error('Kernel is not the verified original iPod4,1 10B500 kernel');
  return {kernel:bytes,tree:dt};
}
async function writeSmall(directory,name,bytes) {
  const file=await directory.getFileHandle(name,{create:true});
  const handle=await file.createSyncAccessHandle();
  try{handle.truncate(0);if(handle.write(new Uint8Array(bytes),{at:0})!==bytes.byteLength)throw new Error('Incomplete metadata write');handle.flush();}finally{handle.close();}
}
async function importFixture(files) {
  if(files.length===1&&/\.(tar\.gz|tgz)$/i.test(files[0].name))return importArchive(files[0]);
  if(diskHandle || guestCreated)throw new Error('Stop the current guest before importing another disk');
  if(!navigator.storage?.getDirectory)throw new Error('This browser does not expose OPFS for the guest disk');
  const byName=new Map(files.map(file=>[file.name,file]));
  const disk=byName.get('root.hfs'),kernel=byName.get('kernel.macho'),tree=byName.get('devicetree.bin');
  if(!disk || disk.size!==8*1024**3)throw new Error('Select root.hfs (8 GiB), kernel.macho and devicetree.bin from the private prepared kit');
  const header=new DataView(await disk.slice(1024,1536).arrayBuffer());
  if(![0x482b,0x4858].includes(header.getUint16(0)) || BigInt(header.getUint32(40))*BigInt(header.getUint32(44))!==BigInt(disk.size))throw new Error('Invalid HFS volume geometry');
  const checked=await checkedBootFiles(kernel,tree),estimate=await navigator.storage.estimate();
  if(estimate.quota-estimate.usage<disk.size+128*1024**2)throw new Error('Not enough browser storage quota for the 8 GiB guest disk');
  const root=await navigator.storage.getDirectory(),name=`podium-vm-${crypto.randomUUID()}`;
  const directory=await root.getDirectoryHandle(name,{create:true});
  let committed=false;
  try {
    const file=await directory.getFileHandle('root.hfs',{create:true});
    if(!file.createSyncAccessHandle)throw new Error('Synchronous OPFS is unavailable in this browser Worker');
    diskHandle=await file.createSyncAccessHandle();diskHandle.truncate(disk.size);
    const block=4*1024*1024;
    for(let offset=0;offset<disk.size;offset+=block) {
      const bytes=new Uint8Array(await disk.slice(offset,offset+block).arrayBuffer());
      if(diskHandle.write(bytes,{at:offset})!==bytes.length)throw new Error('Incomplete guest disk write');
      if(offset%(128*1024*1024)===0)send('import-progress',{fraction:offset/disk.size});
    }
    diskHandle.flush();
    await writeSmall(directory,'kernel.macho',checked.kernel);await writeSmall(directory,'devicetree.bin',checked.tree);
    await writeSmall(root,'podium-active-vm.json',new TextEncoder().encode(JSON.stringify({version:1,directory:name,build:'10B500'})).buffer);
    bootFiles=checked;committed=true;send('fixture-ready',{diskSize:disk.size});
  } finally {
    if(!committed){diskHandle?.close();diskHandle=undefined;await root.removeEntry(name,{recursive:true});}
  }
}
async function importArchive(archive) {
  if(diskHandle||guestCreated)throw new Error('Stop the current guest before importing another disk');
  if(!navigator.storage?.getDirectory||typeof DecompressionStream==='undefined')throw new Error('This browser does not expose OPFS / streaming gzip');
  const estimate=await navigator.storage.estimate();if(estimate.quota-estimate.usage<8*1024**3+128*1024**2)throw new Error('Not enough browser storage quota for the guest disk');
  const root=await navigator.storage.getDirectory(),directoryName=`podium-vm-${crypto.randomUUID()}`;
  const directory=await root.getDirectoryHandle(directoryName,{create:true});let handle,committed=false,written=0,expected=0;
  try{
    await readFixtureTar(archive.stream().pipeThrough(new DecompressionStream('gzip')),{async start(name,size,total){
      const file=await directory.getFileHandle(name,{create:true});if(!file.createSyncAccessHandle)throw new Error('Synchronous OPFS unavailable');
      handle=await file.createSyncAccessHandle();handle.truncate(size);if(name==='root.hfs'){expected=total;written=0;}
    },async data(name,offset,bytes){if(handle.write(bytes,{at:offset})!==bytes.length)throw new Error('Incomplete fixture write');if(name==='root.hfs'){written+=bytes.length;send('import-progress',{fraction:written/expected});}},async end(){handle.flush();handle.close();handle=undefined;}});
    const manifest=JSON.parse(await (await (await directory.getFileHandle('manifest.json')).getFile()).text());
    if(manifest.device!=='iPod4,1'||manifest.build!=='10B500'||manifest.diskSize!==8*1024**3)throw new Error('Wrong device fixture');
    const checked=await checkedBootFiles(await (await directory.getFileHandle('kernel.macho')).getFile(),await (await directory.getFileHandle('devicetree.bin')).getFile());
    const file=await directory.getFileHandle('root.hfs');diskHandle=await file.createSyncAccessHandle();
    const headerBytes=new Uint8Array(512);diskHandle.read(headerBytes,{at:1024});const header=new DataView(headerBytes.buffer);
    if(![0x482b,0x4858].includes(header.getUint16(0))||BigInt(header.getUint32(40))*BigInt(header.getUint32(44))!==8589934592n)throw new Error('Invalid HFS geometry');
    await writeSmall(root,'podium-active-vm.json',new TextEncoder().encode(JSON.stringify({version:1,directory:directoryName,build:'10B500'})).buffer);
    bootFiles=checked;committed=true;send('fixture-ready',{diskSize:diskHandle.getSize()});
  }finally{handle?.close();if(!committed){diskHandle?.close();diskHandle=undefined;await root.removeEntry(directoryName,{recursive:true});}}
}
async function restoreFixture() {
  if(diskHandle || !navigator.storage?.getDirectory)return;
  const root=await navigator.storage.getDirectory();let saved;
  try{saved=JSON.parse(await (await (await root.getFileHandle('podium-active-vm.json')).getFile()).text());}catch(error){if(error.name==='NotFoundError')return;throw error;}
  if(saved.version!==1 || !/^podium-vm-[a-f0-9-]+$/.test(saved.directory))throw new Error('Invalid saved VM metadata');
  const directory=await root.getDirectoryHandle(saved.directory);
  const file=await directory.getFileHandle('root.hfs');
  const checked=await checkedBootFiles(await (await directory.getFileHandle('kernel.macho')).getFile(),await (await directory.getFileHandle('devicetree.bin')).getFile());
  diskHandle=await file.createSyncAccessHandle();
  if(diskHandle.getSize()!==8*1024**3){diskHandle.close();diskHandle=undefined;throw new Error('Saved disk is incomplete');}
  bootFiles=checked;send('fixture-ready',{diskSize:diskHandle.getSize()});
}
function stage(bytes) {
  const pointer=core.podium_allocate(bytes.byteLength)>>>0;
  if(!pointer)throw new Error('Could not allocate boot data');
  new Uint8Array(core.memory.buffer,pointer,bytes.byteLength).set(new Uint8Array(bytes));return pointer;
}
// MessageChannel yields without nested-timer/background timeout clamping.
// Each bounded CPU batch still lets real input/pause messages run.
const guestTasks=new MessageChannel();const guestTaskQueue=[];let guestGeneration=0;
guestTasks.port1.onmessage=()=>{guestTaskQueue.shift()?.();};
function yieldGuest(){return new Promise(resolve=>{guestTaskQueue.push(resolve);guestTasks.port2.postMessage(0);});}
async function guestLoop(generation) {
  let lastFrame=0,lastStats=0;
  try {
    while(guestRunning&&generation===guestGeneration) {
      const result=core.podium_machine_run(100000);
      if(result<0)throw new Error(`Guest CPU stopped (${result}); see the actual guest log`);
      if(performance.now()-lastFrame>200) {
        const pointer=core.podium_frame()>>>0;if(!pointer)throw new Error('Guest framebuffer missing');
        const source=new Uint8Array(core.memory.buffer,pointer,640*960*4),rgba=new Uint8ClampedArray(source.length);
        for(let i=0;i<source.length;i+=4){rgba[i]=source[i+2];rgba[i+1]=source[i+1];rgba[i+2]=source[i];rgba[i+3]=255;}
        postMessage({type:'frame',number:++frameNumber,pixels:rgba.buffer},[rgba.buffer]);lastFrame=performance.now();
      }
      if(performance.now()-lastStats>5000){send('guest-progress',{retired:core.podium_guest_retired().toString()});lastStats=performance.now();}
      await yieldGuest();
    }
  } catch(error){guestRunning=false;send('error',{message:error.message});}
}
async function bootGuest() {
  if(!bootFiles || !diskHandle)throw new Error('No validated local guest image is connected');
  if(!guestCreated) {
    const kp=stage(bootFiles.kernel),tp=stage(bootFiles.tree);let status;
    try{status=core.podium_boot(kp,bootFiles.kernel.byteLength,tp,bootFiles.tree.byteLength);}finally{core.podium_release(kp);core.podium_release(tp);}
    if(status!==0)throw new Error(`Boot preparation failed (${status})`);
    guestCreated=true;
  }
  if(!guestRunning){guestRunning=true;send('guest-executing',{});void guestLoop(++guestGeneration);}
}

async function exportVM(kind){
 if(!diskHandle||!bootFiles)throw Error('Сначала подключите диск виртуальной машины');
 if(!['disk','snapshot'].includes(kind)||kind==='snapshot'&&!guestCreated)throw Error('Полный снимок доступен после запуска гостя');
 if(typeof CompressionStream==='undefined')throw Error('Потоковое сжатие недоступно в этом браузере');
 guestRunning=false;guestGeneration++;if(core.podium_flush()!==0)throw Error('Не удалось сохранить записи диска');
 if(guestCreated)send('guest-paused',{flushed:true});
 const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('podium-exports',{create:true});
 const name=`podium-${kind}-${new Date().toISOString().replace(/[:.]/g,'-')}.podiumvm.gz`;
 const file=await folder.getFileHandle(name,{create:true});let output=await file.createSyncAccessHandle(),finished=false;
 const manifest={version:1,kind,device:'iPod4,1',build:'10B500',diskSize:diskHandle.getSize(),memorySize:kind==='snapshot'?core.memory.buffer.byteLength:0,coreHash,monotonicMs:performance.now()+clockOffsetMs,retired:core.podium_guest_retired().toString(),createdAt:new Date().toISOString()};
 let lastProgress=0;
 try{
  const source=encodeArchive(manifest,{
   disk(offset,count){const bytes=new Uint8Array(count);if(diskHandle.read(bytes,{at:offset})!==count)throw Error('Ошибка чтения диска');return bytes;},
   memory(offset,count){return new Uint8Array(core.memory.buffer,offset,count);},kernel:new Uint8Array(bootFiles.kernel),tree:new Uint8Array(bootFiles.tree),
   async progress(type,done,total){if(performance.now()-lastProgress>300){send('backup-progress',{message:`${type===1?'Диск':type===2?'Память':'Файлы загрузки'}: ${Math.round(done/total*100)}%`});lastProgress=performance.now();}await yieldGuest();}
  }).pipeThrough(new CompressionStream('gzip'));
  const reader=source.getReader();let offset=0;
  try{while(true){const next=await reader.read();if(next.done)break;if(output.write(next.value,{at:offset})!==next.value.length)throw Error('Неполная запись архива');offset+=next.value.length;}}finally{reader.releaseLock();}
  output.flush();output.close();output=undefined;finished=true;
  send('backup-ready',{file:await file.getFile(),name,kind});
 }finally{output?.close();if(!finished)await folder.removeEntry(name);}
}
async function importVM(file){
 if(guestCreated)throw Error('Для восстановления откройте новый сеанс эмулятора');
 if(typeof DecompressionStream==='undefined')throw Error('Потоковое сжатие недоступно');
 const root=await navigator.storage.getDirectory(),name=`podium-vm-${crypto.randomUUID()}`,directory=await root.getDirectoryHandle(name,{create:true});
 let manifest,handles=[],committed=false,lastProgress=0;
 try{
  await decodeArchive(file.stream().pipeThrough(new DecompressionStream('gzip')),{
   async start(m){manifest=m;if(m.kind==='snapshot'&&m.coreHash!==coreHash)throw Error('Снимок создан другой версией ядра эмулятора. Требуется та же версия; копию диска можно загружать отдельно.');
    const estimate=await navigator.storage.estimate();if(estimate.quota-estimate.usage<m.diskSize+m.memorySize+128*1024**2)throw Error('Недостаточно места для восстановления');
    for(const [type,filename,size] of [[1,'root.hfs',m.diskSize],[2,'memory.bin',m.memorySize],[3,'kernel.macho',0],[4,'devicetree.bin',0]]){
      const target=await directory.getFileHandle(filename,{create:true});handles[type]=await target.createSyncAccessHandle();handles[type].truncate(size);
    }
   },async data(type,offset,bytes){if(handles[type].write(bytes,{at:offset})!==bytes.length)throw Error('Неполная запись снимка');if(performance.now()-lastProgress>300){const total=type===1?manifest.diskSize:type===2?manifest.memorySize:bytes.length;send('backup-progress',{mode:'restore',message:`${type===1?'Диск':type===2?'Память':'Файлы загрузки'}: ${Math.min(100,Math.round((offset+bytes.length)/total*100))}%`});lastProgress=performance.now();}},async end(){for(const handle of handles)if(handle)handle.flush();}
  });
  for(const handle of handles)handle?.close();handles=[];
  const checked=await checkedBootFiles(await (await directory.getFileHandle('kernel.macho')).getFile(),await (await directory.getFileHandle('devicetree.bin')).getFile());
  const nextDisk=await (await directory.getFileHandle('root.hfs')).createSyncAccessHandle();
  const headerBytes=new Uint8Array(512);nextDisk.read(headerBytes,{at:1024});const header=new DataView(headerBytes.buffer);
  if(![0x482b,0x4858].includes(header.getUint16(0))||BigInt(header.getUint32(40))*BigInt(header.getUint32(44))!==8589934592n){nextDisk.close();throw Error('Повреждённый диск в архиве');}
  if(manifest.kind==='snapshot'){
   const saved=await (await directory.getFileHandle('memory.bin')).createSyncAccessHandle();
   try{
    if(manifest.memorySize<core.memory.buffer.byteLength)throw Error('Несовместимый размер памяти ядра');
    core.memory.grow((manifest.memorySize-core.memory.buffer.byteLength)/65536);
    const memory=new Uint8Array(core.memory.buffer);memory.fill(0);
    for(let offset=0;offset<manifest.memorySize;offset+=1024*1024){const bytes=memory.subarray(offset,Math.min(offset+1024*1024,manifest.memorySize));if(saved.read(bytes,{at:offset})!==bytes.length)throw Error('Ошибка восстановления памяти');}
   }catch(error){nextDisk.close();throw error;}finally{saved.close();}
   clockOffsetMs=manifest.monotonicMs-performance.now();
  }
  diskHandle?.close();diskHandle=nextDisk;bootFiles=checked;
  await writeSmall(root,'podium-active-vm.json',new TextEncoder().encode(JSON.stringify({version:1,directory:name,build:'10B500'})).buffer);
  committed=true;send('fixture-ready',{diskSize:manifest.diskSize});
  if(manifest.kind==='snapshot'){guestCreated=true;guestRunning=false;send('snapshot-restored',{retired:manifest.retired});const pointer=core.podium_frame()>>>0,bytes=new Uint8Array(core.memory.buffer,pointer,640*960*4),rgba=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i+=4){rgba[i]=bytes[i+2];rgba[i+1]=bytes[i+1];rgba[i+2]=bytes[i];rgba[i+3]=255;}postMessage({type:'frame',pixels:rgba.buffer},[rgba.buffer]);}
  send('backup-imported',{kind:manifest.kind});
 }finally{for(const handle of handles)handle?.close();if(!committed)await root.removeEntry(name,{recursive:true});}
}

function diskIO(write,offset,pointer,length) {
  if(!diskHandle || offset<0n || length<0 || length>16*1024*1024 || offset+BigInt(length)>BigInt(diskHandle.getSize()))return -1;
  const address=pointer>>>0;
  if(address+length>core.memory.buffer.byteLength)return -1;
  try{const bytes=new Uint8Array(core.memory.buffer,address,length);return write?diskHandle.write(bytes,{at:Number(offset)}):diskHandle.read(bytes,{at:Number(offset)});}catch{return -1;}
}
function program(words, thumb=false) {
  if (core.podium_create(16) !== 0) throw new Error('Не удалось выделить память гостя');
  words.forEach((word,i)=>{if(core.podium_write32(i*4,word)!==0) throw new Error('Ошибка загрузки программы');});
  core.podium_thumb(Number(thumb));
}
function snapshot() {
  return {registers:Array.from({length:16},(_,i)=>core.podium_register(i)>>>0),cpsr:core.podium_cpsr()>>>0};
}
onmessage = async ({data})=>{
  try {
    if (data.type==='init') { await load(); await restoreFixture(); send('init-complete',{}); return; }
    if (!core) throw new Error('Ядро ещё не загружено');
    if(archiveBusy)throw Error('Дождитесь завершения сохранения или восстановления');
    if(data.type==='export-vm'||data.type==='import-vm'){archiveBusy=true;try{if(data.type==='export-vm')await exportVM(data.kind);else await importVM(data.file);}finally{archiveBusy=false;}return;}
    if(data.type==='close-disk'){guestRunning=false;guestGeneration++;if(diskHandle){diskHandle.flush();diskHandle.close();diskHandle=undefined;}send('disk-closed',{});return;}
    if(data.type==='import-fixture'){await importFixture(data.files);return;}
    if(data.type==='boot'){await bootGuest();return;}
    if(data.type==='pause'){guestRunning=false;guestGeneration++;const status=core.podium_flush();send('guest-paused',{flushed:status===0});return;}
    if(data.type==='button'){if(guestCreated)core.podium_button(data.code,Number(data.down));return;}
    if(data.type==='touch'){if(guestCreated)core.podium_touch(data.phase,data.x,data.y);return;}
    if(guestCreated)throw new Error('CPU diagnostics cannot replace the running guest machine');
    if (data.type==='selftest') {
      const results=[];
      program([0xe3a01080,0xe3a0002a,0xe5810000,0xe5912000]);
      results.push({name:'ARM: запись и чтение RAM',passed:core.podium_run(4)===4 && core.podium_register(2)===42 && core.podium_read32(128)===42});
      program([0xea000000,0xe3a00007,0xe3a0000a]);
      results.push({name:'ARM: переход через инструкцию',passed:core.podium_run(2)===2 && core.podium_register(0)===10});
      program([0x30032005],true);
      results.push({name:'Thumb: MOVS + ADDS',passed:core.podium_run(2)===2 && core.podium_register(0)===8});
      results.push({name:'A4: таймер, IRQ и MMIO',passed:core.podium_hardware_test()===0});
      results.push({name:'AES: независимый тестовый вектор',passed:core.podium_aes_test()===0});
      send('test',{results,...snapshot()});
    } else if(data.type==='storage-test') {
      if(!navigator.storage?.getDirectory){send('storage-unsupported',{message:'OPFS недоступен в этом браузере. Сохранение гостевого диска не подтверждено.'});return;}
      if(diskHandle)throw new Error('Диск уже открыт');
      const directory=await navigator.storage.getDirectory(),name=`podium-storage-test-${crypto.randomUUID()}`;
      try {
        const file=await directory.getFileHandle(name,{create:true});
        if(!file.createSyncAccessHandle){send('storage-unsupported',{message:'Синхронный OPFS недоступен в Worker. Гостевой диск не подключён.'});return;}
        diskHandle=await file.createSyncAccessHandle();diskHandle.truncate(16);
        const result=core.podium_storage_test();
        diskHandle.close();diskHandle=undefined;
        const handle=await file.createSyncAccessHandle();
        const bytes=new Uint8Array(16);handle.read(bytes,{at:0});handle.close();
        if(result!==0 || new TextDecoder().decode(bytes)!=='PODIUMWEB-OPFS1\n')throw new Error(`OPFS проверка не пройдена: ${result}`);
        send('storage',{passed:true});
      } finally {
        if(diskHandle){diskHandle.close();diskHandle=undefined;}
        await directory.removeEntry(name);
      }
    } else if (data.type==='benchmark') {
      program([0xe2800001,0xeafffffd]); // ADD r0,#1; branch back to ADD
      const start=performance.now(); let retired=0;
      for(let i=0;i<20;i++) {
        const count=core.podium_run(100000);
        if(count<0) throw new Error(`CPU остановлен: ${count}`);
        retired+=count;
        // Give the Worker event loop an opportunity to process termination.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      send('benchmark',{retired,mips:retired/(performance.now()-start)/1000,...snapshot()});
    }
  } catch(error) { send('error',{message:error.message || String(error)}); }
};
