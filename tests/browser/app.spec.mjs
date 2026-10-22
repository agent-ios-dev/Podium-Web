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
 await expect(page.locator('#results .pass')).toHaveCount(3);
 await expect(page.locator('#cpu-status')).toHaveText('ARM/Thumb tests passed');
 await expect(page.locator('#registers')).toContainText('0x00000008');
 await page.getByRole('button',{name:'Benchmark',exact:true}).click();
 await expect(page.locator('#log')).toContainText('2,000,000 instructions');
 await page.getByRole('button',{name:'Stop',exact:true}).click();await expect(page.locator('#cpu-status')).toHaveText('Not active');
 await page.screenshot({path:`reports/${test.info().project.name}-cpu.png`,fullPage:true});
 await page.locator('#tabs').getByRole('button',{name:'Settings',exact:true}).last().click();
 await page.locator('#tabs').getByRole('button',{name:'Home',exact:true}).click();
 await page.getByRole('button',{name:'Launch iPod'}).click();await expect(page.getByRole('button',{name:/Power On/})).toBeDisabled();
 await expect(page.locator('#subtitle')).toHaveText('Powered off');
 await page.screenshot({path:`reports/${test.info().project.name}-emulator.png`,fullPage:true});
});


