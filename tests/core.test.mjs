import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WASI} from 'node:wasi';
const bytes = await readFile(new URL('../web/core.wasm',import.meta.url));
const module = await WebAssembly.compile(bytes);
async function machine(words) {
  const wasi = new WASI({version:'preview1',args:['podium-core'],env:{},preopens:{},returnOnExit:true});
  const instance = await WebAssembly.instantiate(module,{...wasi.getImportObject(),podium_host:{disk_size:()=>0n,disk_read:()=>-1,disk_write:()=>-1,disk_flush:()=>-1}});
  assert.equal(wasi.start(instance),0);
  const e = instance.exports;
  assert.equal(e.podium_create(1),0);
  words.forEach((word,i)=>assert.equal(e.podium_write32(i*4,word),0));
  return e;
}
test('real ARM fetch/decode/execute: arithmetic and register state',async()=>{
  const e = await machine([0xe3a00005,0xe3a01003,0xe0802001]);
  assert.equal(e.podium_run(3),3); assert.equal(e.podium_register(2),8); assert.equal(e.podium_register(15),12);
});
test('ARM branch skips instruction',async()=>{
  const e = await machine([0xea000000,0xe3a00007,0xe3a0000a]);
  assert.equal(e.podium_run(2),2); assert.equal(e.podium_register(0),10);
});
test('guest store/load changes guest RAM',async()=>{
  const e = await machine([0xe3a01080,0xe3a0002a,0xe5810000,0xe5912000]);
  assert.equal(e.podium_run(4),4); assert.equal(e.podium_read32(128),42); assert.equal(e.podium_register(2),42);
});
test('SUBS updates architectural Z and carry flags',async()=>{
  const e = await machine([0xe3a00005,0xe3a01005,0xe0502001]);
  assert.equal(e.podium_run(3),3); assert.equal(e.podium_register(2),0); assert.equal(e.podium_cpsr()>>>29 & 3,3);
});
test('Thumb execution uses the existing decoder',async()=>{
  const e = await machine([0x30032005]); // MOVS r0,#5; ADDS r0,#3
  e.podium_thumb(1); assert.equal(e.podium_run(2),2); assert.equal(e.podium_register(0),8); assert.equal(e.podium_register(15),4);
});
test('invalid guest memory writes and runaway batches are refused',async()=>{
  const e = await machine([]);
  assert.equal(e.podium_write32(1024*1024-2,42),-2); assert.equal(e.podium_write32(0xfffffffc,42),-2);
  assert.equal(e.podium_run(100001),-1); assert.equal(e.podium_create(0),-1);
});
test('A4 timer expiry, IRQ acknowledgement and MMIO alias',async()=>{
  const e = await machine([]); assert.equal(e.podium_hardware_test(),0);
});
test('portable A4 AES engine matches independent FIPS known-answer vector',async()=>{
  const e = await machine([]); assert.equal(e.podium_aes_test(),0);
});
test('boot rejects unregistered buffers instead of accepting an arbitrary pointer',async()=>{
  const e = await machine([]); assert.equal(e.podium_boot(0,0,0,0),-1);
});
