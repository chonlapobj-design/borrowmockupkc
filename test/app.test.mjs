import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const dir=mkdtempSync(path.join(tmpdir(),'borrow-test-')),port=43129,base=`http://127.0.0.1:${port}`;
let child;
async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code)));});}
async function stop(){if(child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
async function req(url,method='GET',data,headers={}){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};}
test('borrowing lifecycle, conflict handling, validation, pagination and persistence',async()=>{try{await start();const record={id:randomUUID(),item:'<img src=x onerror=alert(1)>',borrower:'ทดสอบ',quantity:2,borrow_date:'2026-09-01',due_date:'2026-09-20'};
assert.equal((await req('/api/records','POST',{...record,quantity:-1})).status,400);
assert.equal((await req('/api/records','POST',{...record,due_date:'2026-08-01'})).status,400);
assert.equal((await req('/api/records','POST',record,{Origin:'https://other.example'})).status,403);
assert.equal((await req('/api/records','POST',{...record,image:'data:image/jpeg;base64,YWJj',thumbnail:'data:image/jpeg;base64,YWJj'})).status,400);
assert.equal((await req('/api/records','POST',record)).status,201);
assert.equal((await req('/api/records','POST',record)).status,200);
assert.equal((await req('/api/records')).data.total,1);
const update={...record,item:'แก้ไขชื่อ',version:1};assert.equal((await req('/api/records/'+record.id,'PATCH',update)).status,200);
assert.equal((await req('/api/records/'+record.id,'PATCH',update)).status,409);
assert.equal((await req('/api/records')).data.total,1);
assert.equal((await req('/api/records/'+record.id,'PATCH',{action:'return',version:2})).status,200);
assert.equal((await req('/api/records')).data.total,0);
assert.equal((await req('/api/records?status=returned')).data.total,1);
assert.equal((await req('/api/records/'+record.id,'PATCH',{action:'reopen',version:3})).status,200);
for(let i=0;i<21;i++)assert.equal((await req('/api/records','POST',{...record,id:randomUUID(),item:'รายการ '+i})).status,201);
assert.equal((await req('/api/records')).data.rows.length,20);assert.equal((await req('/api/records?page=2')).data.rows.length,2);
assert.equal((await req('/api/records?q='+encodeURIComponent('แก้ไขชื่อ'))).data.total,1);
await stop();await start();assert.equal((await req('/api/records')).data.total,22);
const page=await fetch(base);assert.equal(page.status,200);assert.match(page.headers.get('Content-Security-Policy'),/script-src 'self'/);
}finally{await stop();rmSync(dir,{recursive:true,force:true});}});
