import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFixtureTar} from '../web/tar-stream.js';

function entry(name, data, type='0') {
  const h=Buffer.alloc(512);h.write(name);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
  h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h.fill(32,148,156);h[156]=type.charCodeAt(0);
  const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
  return Buffer.concat([h,data,Buffer.alloc((512-data.length%512)%512)]);
}
function pax(key,value) {
  const body=` ${key}=${value}\n`;let n=body.length+1;
  while(n!==body.length+String(n).length)n=body.length+String(n).length;
  return Buffer.from(`${n}${body}`);
}
function archive({name='root.hfs',map='2\n1024\n3\n8589934592\n0\n',payload='HFS',truncate=false}={}) {
  const fields=Buffer.concat([pax('GNU.sparse.major','1'),pax('GNU.sparse.minor','0'),pax('GNU.sparse.name',name),pax('GNU.sparse.realsize','8589934592')]);
  const sparse=Buffer.alloc(512);sparse.write(map);
  const bytes=Buffer.concat([
    ...['manifest.json','kernel.macho','devicetree.bin'].map(n=>entry(n,Buffer.from(n))),
    entry('PaxHeader',fields,'x'),entry('GNUSparseFile',Buffer.concat([sparse,Buffer.from(payload)])),Buffer.alloc(1024)
  ]);
  return truncate?bytes.subarray(0,bytes.length-1025):bytes;
}
async function read(bytes) {
  let at=0;const records=[];
  // Deliberately split every header and sparse map across stream chunks.
  const stream=new ReadableStream({pull(c){if(at===bytes.length)return c.close();const end=Math.min(at+137,bytes.length);c.enqueue(bytes.subarray(at,end));at=end;}});
  await readFixtureTar(stream,{async start(name,size,stored){records.push({name,size,stored,writes:[]});},async data(name,offset,bytes){records.at(-1).writes.push({offset,bytes:Buffer.from(bytes).toString()});},async end(){}});
  return records;
}
test('sparse 8 GiB disk streams only allocated extents without expanding holes',async()=>{
  const files=await read(archive()),root=files.at(-1);
  assert.equal(root.size,8589934592);assert.equal(root.stored,3);assert.deepEqual(root.writes,[{offset:1024,bytes:'HFS'}]);assert.equal(files.length,4);
});
test('archive paths cannot escape the fixed fixture names',async()=>{
  await assert.rejects(read(archive({name:'../root.hfs'})),/Unexpected/);
});
test('overlapping sparse extents are rejected',async()=>{
  await assert.rejects(read(archive({map:'2\n1024\n3\n1025\n0\n'})),/Overlapping/);
});
test('truncated archive fails rather than accepting a partial disk',async()=>{
  await assert.rejects(read(archive({truncate:true})),/Truncated/);
});
test('corrupted tar checksum is rejected',async()=>{
  const bytes=archive();bytes[1]^=1;await assert.rejects(read(bytes),/checksum/);
});
