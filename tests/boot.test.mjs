import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BootStatus} from '../web/boot-status.js';
test('estimate uses actual instruction speed and never claims completion from elapsed work',()=>{
 const status=new BootStatus(1e9);status.progress(1e8,1000);const p=status.progress(2e8,2000);
 assert.equal(p.mips,100);assert.equal(p.seconds,8);assert.equal(status.progress(2e9,3000).fraction,.95);assert.equal(status.complete,false);
});
test('loading hides only after three consecutive bright guest frames',()=>{
 const s=new BootStatus(),bright=new Uint8Array(400).fill(200),black=new Uint8Array(400);
 assert.equal(s.frame(bright),false);s.frame(black);assert.equal(s.frame(bright),false);assert.equal(s.frame(bright),false);assert.equal(s.frame(bright),true);assert.equal(s.frame(black),false);assert.equal(s.complete,true);
});
