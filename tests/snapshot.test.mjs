import {test} from 'node:test';import assert from 'node:assert/strict';import {WASI} from 'node:wasi';import {readFile} from 'node:fs/promises';
const module=await WebAssembly.compile(await readFile(new URL('../web/core.wasm',import.meta.url)));
async function instance(){const wasi=new WASI({version:'preview1',args:['snapshot-test'],env:{},preopens:{},returnOnExit:true});const i=await WebAssembly.instantiate(module,{...wasi.getImportObject(),podium_host:{disk_size:()=>0n,disk_read:()=>-1,disk_write:()=>-1,disk_flush:()=>0}});assert.equal(wasi.start(i),0);return i.exports;}
test('fresh Wasm instance restores CPU registers, RAM and decoder state then continues',async()=>{
 const original=await instance();original.podium_create(1);original.podium_write32(0,0xe2800001);original.podium_write32(4,0xeafffffd);original.podium_run(37);original.podium_write32(128,0x12345678);
 const saved=new Uint8Array(original.memory.buffer).slice(),regs=Array.from({length:16},(_,i)=>original.podium_register(i)),flags=original.podium_cpsr();
 const restored=await instance();restored.memory.grow((saved.length-restored.memory.buffer.byteLength)/65536);new Uint8Array(restored.memory.buffer).set(saved);
 assert.deepEqual(Array.from({length:16},(_,i)=>restored.podium_register(i)),regs);assert.equal(restored.podium_read32(128),0x12345678);assert.equal(restored.podium_cpsr(),flags);
 original.podium_run(63);restored.podium_run(63);assert.deepEqual(Array.from({length:16},(_,i)=>restored.podium_register(i)),Array.from({length:16},(_,i)=>original.podium_register(i)));
});
