const $=id=>document.getElementById(id);
let worker,busy=false,lines=[],route='home',previous='home';
const settings={get(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
function navigate(next){
 if(!['home','settings','emulator','firmware','developer'].includes(next))next='home';
 if(next!==route)previous=route;route=next;
 for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==next;
 $('title').textContent={home:'Home',settings:'Settings',emulator:'Podium',firmware:'Firmware',developer:'Developer'}[next];
 $('subtitle').textContent=next==='emulator'?'Powered off':'';
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
function controls(ready){for(const id of ['test','speed','storage-test'])$(id).disabled=!ready;$('stop').disabled=!worker;}
function showRegisters(data){if(!data.registers)return;$('register-section').hidden=false;$('registers').replaceChildren(...data.registers.map((value,i)=>{const row=document.createElement('div'),name=document.createElement('span'),hex=document.createElement('code');row.className='row';name.textContent=i===15?'PC':i===14?'LR':i===13?'SP':`R${i}`;hex.textContent=`0x${value.toString(16).padStart(8,'0')}`;row.append(name,hex);return row;}));}
$('load').onclick=()=>{
 worker?.terminate();worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});state('Loading WebAssembly…');controls(false);$('load').disabled=true;
 worker.onerror=event=>{log(event.message);state('Worker error');$('load').disabled=false;controls(false);};
 worker.onmessage=({data})=>{
  if(data.type==='log'){log(data.text);return;}
  if(data.type==='ready'){state('Interpreter active');log('WebAssembly loaded. Guest iOS is not booted.');$('load').disabled=false;controls(true);return;}
  busy=false;controls(true);showRegisters(data);
  if(data.type==='error'){state('Execution error');log(data.message);return;}
  if(data.type==='test'){$('results').replaceChildren(...data.results.map(result=>{const p=document.createElement('p');p.className=result.passed?'pass':'fail';p.textContent=`${result.passed?'✓':'✗'} ${result.name}`;log(p.textContent);return p;}));state(data.results.every(x=>x.passed)?'ARM/Thumb tests passed':'Test failed');}
  else if(data.type==='benchmark'){log(`${data.retired.toLocaleString()} instructions; ${data.mips.toFixed(2)} MIPS`);state('Interpreter active');}
  else if(data.type==='storage'){log('OPFS: Wasm write → flush → read → close → reopen verified. Temporary test file removed.');state('OPFS test passed');}
  else if(data.type==='storage-unsupported'){log(data.message);state('OPFS unavailable');}
 };
 worker.postMessage({type:'init'});
};
for(const [id,type] of [['test','selftest'],['speed','benchmark'],['storage-test','storage-test']])$(id).onclick=()=>{if(!worker||busy)return;busy=true;controls(false);state('Executing in Web Worker…');worker.postMessage({type});};
$('stop').onclick=()=>{worker?.terminate();worker=null;busy=false;controls(false);$('load').disabled=false;state('Not active');log('Worker stopped.');};
$('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));a.download='podium-web-log.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
navigate('home');
const powerIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v9M6.3 5.5a9 9 0 1 0 11.4 0"/></svg>';
for(const element of document.querySelectorAll('.launch,#power,.display-symbol,.control-bar button[aria-label="Power"]')) element.innerHTML=element.innerHTML.replace('⏻',powerIcon);
const homeIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M5 9v12h5v-7h4v7h5V9"/></svg>';
document.querySelector('.control-bar button[aria-label="Home button"]').innerHTML=homeIcon;
for(const [label,sign] of [['Volume down','−'],['Volume up','+']])document.querySelector(`.control-bar button[aria-label="${label}"]`).innerHTML=`<svg class="icon" viewBox="0 0 28 24" aria-hidden="true"><path d="M3 8h4l6-5v18l-6-5H3z"/><text x="18" y="16" fill="currentColor" stroke="none" font-size="17">${sign}</text></svg>`;
