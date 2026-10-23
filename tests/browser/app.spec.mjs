import {test,expect} from '@playwright/test';
test('Podium navigation and actual Wasm execution',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'iPod Touch 4',exact:true})).toBeVisible();
 await expect.poll(()=>page.locator('.ipod-preview').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 await page.screenshot({path:`reports/${test.info().project.name}-home-redesign.png`,fullPage:true});
 await page.locator('#tabs').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByLabel('Appearance',{exact:true}).selectOption('light');await expect(page.locator('body')).toHaveClass(/light/);
 await page.getByLabel('Appearance',{exact:true}).selectOption('dark');
 await page.getByRole('button',{name:/Developer Console/}).click();
 await page.getByRole('button',{name:'Load WebAssembly Core'}).click();
 await expect(page.locator('#cpu-status')).toHaveText('Interpreter active');
 await page.getByRole('button',{name:'Test ARMv7',exact:true}).click();
 // The first execution lazily compiles the large Swift Wasm core on Linux WebKit.
 await expect(page.locator('#results .pass')).toHaveCount(5,{timeout:30000});
 await expect(page.locator('#cpu-status')).toHaveText('ARM/Thumb tests passed');
 await expect(page.locator('#registers')).toContainText('0x00000008');
 await page.getByRole('button',{name:'Benchmark',exact:true}).click();
 await expect(page.locator('#log')).toContainText('2,000,000 instructions');
 await page.getByRole('button',{name:'Test OPFS disk',exact:true}).click();
 await expect(page.locator('#cpu-status')).toHaveText(/^(OPFS test passed|OPFS unavailable)$/);
 await test.info().attach('storage-capability',{body:await page.locator('#cpu-status').innerText(),contentType:'text/plain'});
 if(test.info().project.name==='chromium')await expect(page.locator('#cpu-status')).toHaveText('OPFS test passed');
 await page.getByRole('button',{name:'Stop',exact:true}).click();await expect(page.locator('#cpu-status')).toHaveText('Not active');
 await page.screenshot({path:`reports/${test.info().project.name}-cpu.png`,fullPage:true});
 await page.locator('#tabs').getByRole('button',{name:'Settings',exact:true}).last().click();
 await page.locator('#tabs').getByRole('button',{name:'Home',exact:true}).click();
 await page.getByRole('button',{name:'Start iOS'}).click();await expect(page.getByRole('button',{name:/Power On/})).toBeDisabled();
 await expect(page.locator('#subtitle')).toHaveText('Powered off');
 const display=await page.locator('#display').boundingBox(),bar=await page.locator('.control-bar').boundingBox(),power=await page.locator('#power').boundingBox();
 expect(display.y+display.height).toBeLessThanOrEqual(bar.y);expect(power.y+power.height).toBeLessThanOrEqual(display.y);
 await page.screenshot({path:`reports/${test.info().project.name}-emulator.png`,fullPage:true});
});



// Synthetic worker messages verify loading presentation only, not real iOS boot.
test('boot overlay, speed and ETA disappear when guest graphics arrive',async({page})=>{
 await page.route('**/worker.js',route=>route.fulfill({contentType:'text/javascript',body:`onmessage=({data})=>{
 if(data.type==='init'){postMessage({type:'ready'});postMessage({type:'fixture-ready'});postMessage({type:'init-complete'});}
 if(data.type==='boot'){postMessage({type:'guest-executing'});postMessage({type:'guest-progress',retired:'100000000'});setTimeout(()=>postMessage({type:'guest-progress',retired:'200000000'}),100);}
 if(data.type==='button'){const pixels=new Uint8Array(640*960*4).fill(180);for(let i=0;i<3;i++)postMessage({type:'frame',pixels:pixels.buffer});}
 };`}));
 await page.goto('/');await page.getByRole('button',{name:'Start iOS'}).click();
 await expect(page.locator('#power')).toBeEnabled();await page.locator('#power').click();
 await expect(page.locator('#boot-overlay')).toBeVisible();await expect(page.locator('#boot-speed')).toContainText('млн инструкций/с');
 const bounds=await page.locator('#boot-details').boundingBox(),screen=await page.locator('#display').boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(screen.y+screen.height);
 await page.screenshot({path:`reports/${test.info().project.name}-boot-loading.png`,fullPage:true});
 await page.getByRole('button',{name:'Home button',exact:true}).click();
 await expect(page.locator('#boot-overlay')).toBeHidden();await expect(page.locator('#boot-details')).toBeHidden();
});
// UI transition regression: restoring after a running guest must start a new Worker.
test('snapshot import replaces a paused worker and exposes Resume',async({page})=>{
 await page.route('**/worker.js',route=>route.fulfill({contentType:'text/javascript',body:`onmessage=({data})=>{
 if(data.type==='init'){postMessage({type:'ready'});postMessage({type:'fixture-ready'});postMessage({type:'init-complete'});}
 if(data.type==='boot')postMessage({type:'guest-executing'});
 if(data.type==='close-disk')postMessage({type:'disk-closed'});
 if(data.type==='import-vm'){postMessage({type:'snapshot-restored',retired:'123456789'});postMessage({type:'backup-imported',kind:'snapshot'});}
 };`}));
 await page.goto('/');await page.getByRole('button',{name:'Start iOS'}).click();await expect(page.locator('#power')).toBeEnabled();await page.locator('#power').click();await expect(page.locator('#power')).toHaveText('Pause');
 await page.getByRole('button',{name:'‹ Home',exact:true}).click();await page.locator('#tabs').getByRole('button',{name:'Settings',exact:true}).click();
 const chooserPromise=page.waitForEvent('filechooser');await page.locator('#restore-vm').click();const chooser=await chooserPromise;await chooser.setFiles({name:'ui-test.podiumvm.gz',mimeType:'application/gzip',buffer:Buffer.from('synthetic UI test')});
 await expect(page.locator('#backup-status')).toContainText('Снимок восстановлен');
 await page.locator('#tabs').getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Start iOS'}).click();await expect(page.locator('#power')).toHaveText('Resume');await expect(page.locator('#boot-overlay')).toBeHidden();
});
test('snapshot import starts core from Settings on a fresh page',async({page})=>{
 await page.route('**/worker.js',route=>route.fulfill({contentType:'text/javascript',body:`onmessage=({data})=>{if(data.type==='init'){postMessage({type:'ready'});postMessage({type:'init-complete'});}if(data.type==='import-vm'){postMessage({type:'fixture-ready'});postMessage({type:'snapshot-restored',retired:'123'});postMessage({type:'backup-imported',kind:'snapshot'});}};`}));
 await page.goto('/');await page.locator('#tabs').getByRole('button',{name:'Settings',exact:true}).click();
 const waiting=page.waitForEvent('filechooser');await page.locator('#restore-vm').click();const chooser=await waiting;await chooser.setFiles({name:'ui-test.podiumvm.gz',mimeType:'application/gzip',buffer:Buffer.from('UI test')});
 await expect(page.locator('#backup-status')).toContainText('Снимок восстановлен');await expect(page.locator('#restore-vm')).toBeEnabled();
});
