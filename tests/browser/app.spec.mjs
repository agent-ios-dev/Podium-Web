import {test,expect} from '@playwright/test';
test('Podium navigation and actual Wasm execution',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'iPod touch 4',exact:true})).toBeVisible();
 await page.locator('#tabs').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByLabel('Appearance',{exact:true}).selectOption('light');await expect(page.locator('body')).toHaveClass(/light/);
 await page.getByLabel('Appearance',{exact:true}).selectOption('dark');
 await page.getByRole('button',{name:/Developer Console/}).click();
 await page.getByRole('button',{name:'Load WebAssembly Core'}).click();
 await expect(page.locator('#cpu-status')).toHaveText('Interpreter active');
 await page.getByRole('button',{name:'Test ARMv7',exact:true}).click();
 await expect(page.locator('#results .pass')).toHaveCount(5);
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
 await page.getByRole('button',{name:'Launch iPod'}).click();await expect(page.getByRole('button',{name:/Power On/})).toBeDisabled();
 await expect(page.locator('#subtitle')).toHaveText('Powered off');
 await page.screenshot({path:`reports/${test.info().project.name}-emulator.png`,fullPage:true});
});



// Synthetic worker messages verify loading presentation only, not real iOS boot.
test('boot overlay, speed and ETA disappear when guest graphics arrive',async({page})=>{
 await page.route('**/worker.js',route=>route.fulfill({contentType:'text/javascript',body:`onmessage=({data})=>{
 if(data.type==='init'){postMessage({type:'ready'});postMessage({type:'fixture-ready'});postMessage({type:'init-complete'});}
 if(data.type==='boot'){postMessage({type:'guest-executing'});postMessage({type:'guest-progress',retired:'100000000'});setTimeout(()=>postMessage({type:'guest-progress',retired:'200000000'}),100);}
 if(data.type==='button'){const pixels=new Uint8Array(640*960*4).fill(180);for(let i=0;i<3;i++)postMessage({type:'frame',pixels:pixels.buffer});}
 };`}));
 await page.goto('/');await page.getByRole('button',{name:'Launch iPod'}).click();
 await expect(page.locator('#power')).toBeEnabled();await page.locator('#power').click();
 await expect(page.locator('#boot-overlay')).toBeVisible();await expect(page.locator('#boot-speed')).toContainText('млн инструкций/с');
 const bounds=await page.locator('#boot-details').boundingBox(),screen=await page.locator('#display').boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(screen.y+screen.height);
 await page.screenshot({path:`reports/${test.info().project.name}-boot-loading.png`,fullPage:true});
 await page.getByRole('button',{name:'Home button',exact:true}).click();
 await expect(page.locator('#boot-overlay')).toBeHidden();await expect(page.locator('#boot-details')).toBeHidden();
});
