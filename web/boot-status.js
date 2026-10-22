// UI-only estimate. A progress percentage never establishes guest boot success.
export class BootStatus {
  constructor(target=8_000_000_000){this.target=Number.isFinite(target)&&target>1e8?target:8e9;this.last=undefined;this.speed=0;this.brightFrames=0;this.complete=false;}
  progress(retired,now){
    if(this.last&&now>this.last.time){const rate=Math.max(0,retired-this.last.retired)/((now-this.last.time)/1000);this.speed=this.speed?this.speed*.65+rate*.35:rate;}
    this.last={retired,time:now};
    return {fraction:Math.min(.95,retired/this.target),mips:this.speed/1e6,seconds:this.speed>0&&retired<this.target?(this.target-retired)/this.speed:null};
  }
  frame(bytes){
    if(this.complete)return false;
    let bright=0,total=0;for(let i=0;i<bytes.length;i+=4*37){total++;if(bytes[i]+bytes[i+1]+bytes[i+2]>144)bright++;}
    this.brightFrames=total&&bright/total>.4?this.brightFrames+1:0;
    if(this.brightFrames>=3){this.complete=true;return true;}return false;
  }
}
