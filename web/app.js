import {BootStatus} from './boot-status.js';
let bootStatus;
const $=id=>document.getElementById(id);
let worker,busy=false,lines=[],route='home',previous='home',coreReady=false,pendingFiles,fixtureReady=false,guestActive=false,guestStarted=false;
const settings={get(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
function navigate(next){
 if(!['home','settings','emulator','firmware','developer'].includes(next))next='home';
 if(next!==route)previous=route;route=next;
 for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==next;
 $('title').textContent={home:'Home',settings:'Settings',emulator:'Podium',firmware:'Firmware',developer:'Developer'}[next];
 $('subtitle').textContent=next==='emulator'?(guestStarted?(guestActive?'Guest executing':'Paused'):'Powered off'):'';
 $('back').hidden=['home','settings'].includes(next);$('back-label').textContent=next==='developer'&&previous==='settings'?'Settings':'Home';
 $('expand').hidden=next!=='emulator';$('tabs').hidden=next==='emulator';
 document.querySelectorAll('.tab-bar button').forEach(x=>x.classList.toggle('selected',x.dataset.route===next));
 window.scrollTo(0,0);
}
for(const button of document.querySelectorAll('[data-route]'))button.onclick=()=>navigate(button.dataset.route);
$('back').onclick=()=>navigate(route==='developer'&&previous==='settings'?'settings':'home');
$('expand').onclick=()=>{document.body.classList.toggle('immersive');$('expand').setAttribute('aria-label',document.body.classList.contains('immersive')?'Exit fullscreen':'Fullscreen');};
$('appearance').value=settings.get('appearance','dark');
function applyAppearance(){const value=$('appearance').value;document.body.classList.toggle('light',value==='light'||value==='system'&&matchMedia('(prefers-color-scheme: light)').matches);}
$('appearance').onchange=()=>{settings.set('appearance',$('appearance').value);applyAppearance();};applyAppearance();
matchMedia('(prefers-color-scheme: light)').addEventListener('change',applyAppearance);
$('case').checked=settings.get('case','false')==='true';
function applyCase(){document.body.classList.toggle('has-case',$('case').checked);}
$('case').onchange=()=>{settings.set('case',String($('case').checked));applyCase();};applyCase();
$('show-dev').onchange=()=>{$('developer-link').hidden=!$('show-dev').checked;};
for(const [name,detail] of [['Install IPA Apps','Add .ipa apps to /Applications'],['Add Files','Copy files into the guest media folder'],['Offline Packages','Install .deb payloads offline'],['Back Up Virtual iPod','Export a guest disk snapshot'],['Restore Backup','Replace guest data from a saved image']]){
 const button=document.createElement('button'),text=document.createElement('span'),small=document.createElement('small');button.className='link-row';button.disabled=true;text.textContent=name;small.textContent=detail;text.append(small);button.append(text);$('storage-actions').append(button);
}
function log(text){lines.push(`${new Date().toLocaleTimeString()}  ${text}`);$('log').textContent=lines.join('\n');}
function state(text){$('cpu-status').textContent=text;}
function controls(ready){for(const id of ['test','speed','storage-test'])$(id).disabled=!ready||guestStarted;$('stop').disabled=!worker||guestStarted;$('load').disabled=guestStarted;}
function showRegisters(data){if(!data.registers)return;$('register-section').hidden=false;$('registers').replaceChildren(...data.registers.map((value,i)=>{const row=document.createElement('div'),name=document.createElement('span'),hex=document.createElement('code');row.className='row';name.textContent=i===15?'PC':i===14?'LR':i===13?'SP':`R${i}`;hex.textContent=`0x${value.toString(16).padStart(8,'0')}`;row.append(name,hex);return row;}));}
$('load').onclick=()=>{
 if(guestStarted)return;
 coreReady=false;
 worker?.terminate();worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});state('Loading WebAssembly…');controls(false);$('load').disabled=true;
 worker.onerror=event=>{log(event.message);state('Worker error');$('load').disabled=false;controls(false);};
 worker.onmessage=({data})=>{
  if(data.type==='log'){log(data.text);return;}
  if(data.type==='init-complete'){coreReady=true;if(pendingFiles){worker.postMessage({type:'import-fixture',files:pendingFiles});pendingFiles=undefined;}return;}
  if(data.type==='import-progress'){$('fixture-status').textContent=`Copying prepared guest disk: ${Math.round(data.fraction*100)}%`;return;}
  if(data.type==='fixture-ready'){fixtureReady=true;busy=false;$('import-prepared').disabled=false;$('power').disabled=false;$('fixture-status').textContent='Local iPod4,1 / 10B500 disk connected. Guest boot is still unverified.';document.querySelector('.pill').textContent='Prepared';document.querySelector('.firmware-card .secondary').textContent='iOS 6.1.6 · Build 10B500 · Local disk';log('Validated prepared guest files connected locally; no upload.');return;}
  if(data.type==='guest-executing'){if(!guestStarted){bootStatus=new BootStatus(Number(settings.get('boot-instructions','8000000000')));$('boot-overlay').hidden=false;$('boot-details').hidden=false;$('emulator').classList.add('booting');}guestStarted=true;guestActive=true;controls(false);$('load').disabled=true;document.querySelectorAll('.control-bar button').forEach(button=>button.disabled=false);$('subtitle').textContent='Guest executing';$('power').textContent='Pause';$('power').disabled=false;log('Original guest instructions executing. This status is not SpringBoard proof.');return;}
  if(data.type==='guest-paused'){if(bootStatus&&!bootStatus.complete){bootStatus.last=undefined;$('boot-eta').textContent='Загрузка приостановлена';$('boot-speed').textContent='Скорость: —';}guestActive=false;$('subtitle').textContent='Paused';$('power').textContent='Resume';log(data.flushed?'Host disk writes flushed. Guest remains paused in RAM.':'Disk flush failed; keep this tab open.');return;}
  if(data.type==='guest-progress'){
    const retired=Number(data.retired);$('guest-progress').textContent=`${retired.toLocaleString()} guest instructions`;
    if(bootStatus&&!bootStatus.complete){const status=bootStatus.progress(retired,performance.now());$('boot-bar').value=status.fraction;
      $('boot-eta').textContent=status.seconds===null?'Оставшееся время уточняется…':`Осталось примерно ${status.seconds<60?Math.max(1,Math.ceil(status.seconds))+' сек.':Math.ceil(status.seconds/60)+' мин.'}`;
      $('boot-speed').textContent=status.mips?`Скорость: ${status.mips.toFixed(1)} млн инструкций/с`:'Скорость: измеряем…';}return;}

  if(data.type==='frame'){if(bootStatus?.frame(new Uint8Array(data.pixels))){$('boot-overlay').hidden=true;$('boot-details').hidden=true;$('emulator').classList.remove('booting');if(bootStatus.last)settings.set('boot-instructions',String(bootStatus.last.retired));log('Bright guest interface detected; loading overlay hidden. This is not app-launch verification.');}const pixels=new ImageData(new Uint8ClampedArray(data.pixels),640,960);$('guest-canvas').getContext('2d').putImageData(pixels,0,0);$('guest-canvas').hidden=false;$('display').querySelectorAll('p').forEach(p=>p.hidden=true);return;}
  if(data.type==='ready'){state('Interpreter active');log('WebAssembly loaded. Guest iOS is not booted.');$('load').disabled=false;controls(true);return;}
  busy=false;controls(true);showRegisters(data);
  if(data.type==='error'){$('boot-overlay').hidden=true;$('boot-details').hidden=true;$('emulator').classList.remove('booting');$('import-prepared').disabled=guestStarted;state('Execution error');log(data.message);if(guestStarted){guestActive=false;$('subtitle').textContent='Guest halted';}else{$('fixture-status').textContent=data.message;}return;}
  if(data.type==='test'){$('results').replaceChildren(...data.results.map(result=>{const p=document.createElement('p');p.className=result.passed?'pass':'fail';p.textContent=`${result.passed?'✓':'✗'} ${result.name}`;log(p.textContent);return p;}));state(data.results.every(x=>x.passed)?'ARM/Thumb tests passed':'Test failed');}
  else if(data.type==='benchmark'){log(`${data.retired.toLocaleString()} instructions; ${data.mips.toFixed(2)} MIPS`);state('Interpreter active');}
  else if(data.type==='storage'){log('OPFS: Wasm write → flush → read → close → reopen verified. Temporary test file removed.');state('OPFS test passed');}
  else if(data.type==='storage-unsupported'){log(data.message);state('OPFS unavailable');}
 };
 worker.postMessage({type:'init'});
};
for(const [id,type] of [['test','selftest'],['speed','benchmark'],['storage-test','storage-test']])$(id).onclick=()=>{if(!worker||busy)return;busy=true;controls(false);state('Executing in Web Worker…');worker.postMessage({type});};
$('stop').onclick=()=>{worker?.terminate();worker=null;busy=false;coreReady=false;fixtureReady=false;$('power').disabled=true;controls(false);$('load').disabled=false;state('Not active');log('Worker stopped.');};
$('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));a.download='podium-web-log.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
document.querySelector('.launch').onclick=()=>{navigate('emulator');if(!worker)$('load').click();};
navigate('home');
const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.accept='.gz,.tgz,.hfs,.macho,.bin,.json';picker.hidden=true;document.body.append(picker);
$('import-prepared').onclick=()=>{if(!busy&&!guestStarted)picker.click();};
picker.onchange=()=>{
 if(!picker.files?.length)return;if(guestStarted){log('Pause and close the current guest before replacing the disk.');return;}
 if(busy)return;pendingFiles=Array.from(picker.files);busy=true;$('import-prepared').disabled=true;$('fixture-status').textContent='Validating prepared files…';
 if(!worker)$('load').click();else if(coreReady){worker.postMessage({type:'import-fixture',files:pendingFiles});pendingFiles=undefined;}
};
$('power').onclick=()=>{if(!worker||!fixtureReady)return;worker.postMessage({type:guestActive?'pause':'boot'});};
const canvas=$('guest-canvas');let touching=false;
function sendTouch(event,phase){const rect=canvas.getBoundingClientRect();worker?.postMessage({type:'touch',phase,x:Math.max(0,Math.min(640,(event.clientX-rect.left)*640/rect.width)),y:Math.max(0,Math.min(960,(event.clientY-rect.top)*960/rect.height))});}
canvas.onpointerdown=event=>{if(!guestActive)return;touching=true;canvas.setPointerCapture(event.pointerId);sendTouch(event,0);};
canvas.onpointermove=event=>{if(touching)sendTouch(event,1);};canvas.onpointerup=canvas.onpointercancel=event=>{if(touching)sendTouch(event,2);touching=false;};
for(const [label,code] of [['Home button',0],['Power',1],['Volume down',2],['Volume up',3]]){
 const button=document.querySelector(`.control-bar button[aria-label="${label}"]`);
 button.onpointerdown=event=>{if(!guestActive)return;button.setPointerCapture(event.pointerId);worker.postMessage({type:'button',code,down:true});};
 button.onpointerup=button.onpointercancel=()=>{if(guestStarted)worker.postMessage({type:'button',code,down:false});};
}
const powerIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v9M6.3 5.5a9 9 0 1 0 11.4 0"/></svg>';
for(const element of document.querySelectorAll('.launch,#power,.display-symbol,.control-bar button[aria-label="Power"]')) element.innerHTML=element.innerHTML.replace('⏻',powerIcon);
const homeIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M5 9v12h5v-7h4v7h5V9"/></svg>';
document.querySelector('.control-bar button[aria-label="Home button"]').innerHTML=homeIcon;
for(const [label,sign] of [['Volume down','−'],['Volume up','+']])document.querySelector(`.control-bar button[aria-label="${label}"]`).innerHTML=`<svg class="icon" viewBox="0 0 28 24" aria-hidden="true"><path d="M3 8h4l6-5v18l-6-5H3z"/><text x="18" y="16" fill="currentColor" stroke="none" font-size="17">${sign}</text></svg>`;
