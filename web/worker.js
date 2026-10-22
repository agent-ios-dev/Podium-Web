import {WASI, File, OpenFile, ConsoleStdout} from './vendor/index.js';
let core, diskHandle;
const send = (type, data) => postMessage({type,...data});
async function load() {
  const wasi = new WASI(['podium-core'], [], [new OpenFile(new File([])),
    ConsoleStdout.lineBuffered(text=>send('log',{text})),
    ConsoleStdout.lineBuffered(text=>send('log',{text}))]);
  const response = await fetch('./core.wasm');
  if (!response.ok) throw new Error('Ядро core.wasm отсутствует. Выполните сборку.');
  const module = await WebAssembly.compileStreaming(response);
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
    if (data.type==='init') { await load(); return; }
    if (!core) throw new Error('Ядро ещё не загружено');
    if (data.type==='selftest') {
      const results=[];
      program([0xe3a01080,0xe3a0002a,0xe5810000,0xe5912000]);
      results.push({name:'ARM: запись и чтение RAM',passed:core.podium_run(4)===4 && core.podium_register(2)===42 && core.podium_read32(128)===42});
      program([0xea000000,0xe3a00007,0xe3a0000a]);
      results.push({name:'ARM: переход через инструкцию',passed:core.podium_run(2)===2 && core.podium_register(0)===10});
      program([0x30032005],true);
      results.push({name:'Thumb: MOVS + ADDS',passed:core.podium_run(2)===2 && core.podium_register(0)===8});
      send('test',{results,...snapshot()});
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
