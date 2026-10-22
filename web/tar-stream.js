// Bounded reader for our private POSIX tar / GNU sparse 1.0 fixture format.
// Never expands an 8-GiB image in RAM and never resolves archive paths on host.
export async function readFixtureTar(stream, visitor) {
  const reader=stream.getReader();let chunk=new Uint8Array(),position=0;
  async function take(count) {
    if(!Number.isSafeInteger(count)||count<0||count>4*1024*1024)throw new Error('Invalid archive read size');
    const out=new Uint8Array(count);let done=0;
    while(done<count){
      if(position===chunk.length){const next=await reader.read();if(next.done)throw new Error('Truncated fixture archive');chunk=next.value;position=0;}
      const n=Math.min(count-done,chunk.length-position);out.set(chunk.subarray(position,position+n),done);position+=n;done+=n;
    }
    return out;
  }
  const decoder=new TextDecoder();
  const text=bytes=>decoder.decode(bytes).split('\0')[0];
  function number(bytes){
    if(bytes[0]&128){let result=BigInt(bytes[0]&127);for(const b of bytes.subarray(1))result=result*256n+BigInt(b);if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Archive integer overflow');return Number(result);}
    const value=text(bytes).trim();if(!/^[0-7]*$/.test(value))throw new Error('Invalid tar number');return parseInt(value||'0',8);
  }
  function decimal(value){if(!/^\d+$/.test(value||''))throw new Error('Invalid sparse size');const n=Number(value);if(!Number.isSafeInteger(n)||n>9*1024**3)throw new Error('Sparse file too large');return n;}
  function paxFields(bytes){
    const fields={};let offset=0;
    while(offset<bytes.length){let space=offset;while(space<bytes.length&&bytes[space]!==32)space++;const n=Number(decoder.decode(bytes.subarray(offset,space)));if(!Number.isInteger(n)||n<=space-offset+2||offset+n>bytes.length)throw new Error('Invalid PAX record');const record=decoder.decode(bytes.subarray(space+1,offset+n-1)),eq=record.indexOf('=');if(eq<1)throw new Error('Invalid PAX key');fields[record.slice(0,eq)]=record.slice(eq+1);offset+=n;}
    return fields;
  }
  let pax={},entries=0;const seen=new Set();
  while(true){
    const header=await take(512);
    if(header.every(b=>b===0)){
      const second=await take(512);if(second.some(b=>b!==0))throw new Error('Invalid tar ending');
      // Drain gzip to validate its trailer/CRC; reject unexpected trailing data.
      let trailing=chunk.subarray(position);if(trailing.some(b=>b!==0))throw new Error('Trailing archive data');let tail=trailing.length;
      while(true){const next=await reader.read();if(next.done)break;tail+=next.value.length;if(tail>1024*1024||next.value.some(b=>b!==0))throw new Error('Invalid archive padding');}
      if(seen.size!==4)throw new Error('Incomplete fixture kit');return;
    }
    const expected=number(header.subarray(148,156));let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:header[i];
    if(checksum!==expected)throw new Error('Tar header checksum mismatch');
    const stored=number(header.subarray(124,136)),type=header[156];
    if(type===120){if(stored>65536)throw new Error('PAX record too large');pax=paxFields(await take(stored));await take((512-stored%512)%512);continue;}
    if(type!==0&&type!==48)throw new Error('Only regular fixture files are accepted');
    let name=pax['GNU.sparse.name']||pax.path||text(header.subarray(0,100));if(name.startsWith('./'))name=name.slice(2);
    if(!['manifest.json','kernel.macho','devicetree.bin','root.hfs'].includes(name)||seen.has(name)||++entries>4)throw new Error('Unexpected or duplicate fixture file');seen.add(name);
    const logical=pax['GNU.sparse.realsize']?decimal(pax['GNU.sparse.realsize']):pax.size?decimal(pax.size):stored;
    if(name==='root.hfs'?logical!==8*1024**3:logical>64*1024**2)throw new Error('Invalid fixture file size');
    let extents=[{offset:0,length:stored}],mapBytes=0;
    if(pax['GNU.sparse.major']){
      if(pax['GNU.sparse.major']!=='1'||pax['GNU.sparse.minor']!=='0'||name!=='root.hfs')throw new Error('Unsupported sparse format');
      async function line(){let result='';for(let i=0;i<32;i++){const b=(await take(1))[0];mapBytes++;if(b===10)return decimal(result);if(b<48||b>57)throw new Error('Invalid sparse map');result+=String.fromCharCode(b);}throw new Error('Sparse map line too long');}
      const count=await line();if(count>4096)throw new Error('Sparse map too large');extents=[];let end=0,total=0;
      for(let i=0;i<count;i++){const offset=await line(),length=await line();if(offset<end||offset+length>logical)throw new Error('Overlapping or out-of-range sparse map');extents.push({offset,length});end=offset+length;total+=length;}
      const padding=(512-mapBytes%512)%512;await take(padding);mapBytes+=padding;if(mapBytes+total!==stored)throw new Error('Sparse data length mismatch');
    }else if(logical!==stored)throw new Error('Unmatched archive size');
    const total=extents.reduce((n,e)=>n+e.length,0);await visitor.start(name,logical,total);
    for(const extent of extents)for(let done=0;done<extent.length;){const n=Math.min(4*1024*1024,extent.length-done);await visitor.data(name,extent.offset+done,await take(n));done+=n;}
    await visitor.end(name);await take((512-stored%512)%512);pax={};
  }
}
