// Versioned, streamed backup format. Private guest bytes never leave the browser.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const magic=encoder.encode('PODIUMVM1\n');
export const BLOCK=1024*1024;
function record(type,offset,length){const bytes=new Uint8Array(13),v=new DataView(bytes.buffer);v.setUint8(0,type);v.setBigUint64(1,BigInt(offset),true);v.setUint32(9,length,true);return bytes;}
export function validateManifest(m){
 if(m.version!==1||!['disk','snapshot'].includes(m.kind)||m.device!=='iPod4,1'||m.build!=='10B500'||m.diskSize!==8589934592||!Number.isSafeInteger(m.memorySize)||m.memorySize<0||m.memorySize>2147483648||m.memorySize%65536||!Number.isFinite(m.monotonicMs)||!/^[a-f0-9]{64}$/.test(m.coreHash))throw Error('Unsupported or invalid VM backup');
 if(m.kind==='disk'&&m.memorySize!==0||m.kind==='snapshot'&&m.memorySize<65536)throw Error('Invalid saved memory size');
}
function nonzero(bytes){
 const words=new Uint32Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.length/4));
 for(let i=0;i<words.length;i++)if(words[i])return true;
 for(let i=words.length*4;i<bytes.length;i++)if(bytes[i])return true;return false;
}
export function encodeArchive(manifest,source){
 validateManifest(manifest);
 async function* parts(){
  const json=encoder.encode(JSON.stringify(manifest));if(json.length>16384)throw Error('Backup metadata too large');
  const size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,json.length,true);
  yield magic;yield size;yield json;
  for(const [type,length] of [[1,manifest.diskSize],[2,manifest.memorySize],[3,source.kernel.length],[4,source.tree.length]]){
   for(let offset=0;offset<length;offset+=BLOCK){const count=Math.min(BLOCK,length-offset);
    const bytes=type===1?await source.disk(offset,count):type===2?source.memory(offset,count):type===3?source.kernel.subarray(offset,offset+count):source.tree.subarray(offset,offset+count);
    if(bytes.length!==count)throw Error('Incomplete backup read');
    if(nonzero(bytes)){yield record(type,offset,count);yield bytes;}
    await source.progress?.(type,offset+count,length);
   }
  }
  yield record(0,0,0);
 }
 const iterator=parts();
 return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await iterator.return?.();}});
}
export async function decodeArchive(stream,visitor){
 const reader=stream.getReader();let current=new Uint8Array(),at=0;
 async function take(n){const bytes=new Uint8Array(n);let used=0;while(used<n){if(at===current.length){const next=await reader.read();if(next.done)throw Error('Truncated VM backup');current=next.value;at=0;}const count=Math.min(n-used,current.length-at);bytes.set(current.subarray(at,at+count),used);at+=count;used+=count;}return bytes;}
 try{
  if(decoder.decode(await take(magic.length))!==decoder.decode(magic))throw Error('Not a Podium VM backup');
  const length=new DataView((await take(4)).buffer).getUint32(0,true);if(length<2||length>16384)throw Error('Invalid backup header');
  const manifest=JSON.parse(decoder.decode(await take(length)));validateManifest(manifest);await visitor.start(manifest);
  const limits=[0,manifest.diskSize,manifest.memorySize,64*1024**2,1024**2],ends=[0,0,0,0,0];let previous=1,records=0;
  while(true){const v=new DataView((await take(13)).buffer),type=v.getUint8(0),offset=Number(v.getBigUint64(1,true)),count=v.getUint32(9,true);
   if(type===0){if(offset||count)throw Error('Invalid backup ending');break;}
   if(type<previous||type>4||++records>13000||!count||count>BLOCK||!Number.isSafeInteger(offset)||offset<ends[type]||offset+count>limits[type])throw Error('Invalid or overlapping backup block');
   previous=type;ends[type]=offset+count;await visitor.data(type,offset,await take(count));
  }
  if(at!==current.length)throw Error('Trailing backup bytes');const tail=await reader.read();if(!tail.done)throw Error('Trailing backup bytes');
  await visitor.end(manifest);return manifest;
 }finally{reader.releaseLock();}
}
