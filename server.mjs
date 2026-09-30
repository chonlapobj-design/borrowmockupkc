import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const dir=path.resolve(process.env.DATA_DIR||'data');
fs.mkdirSync(path.join(dir,'photos'),{recursive:true});
const db=new DatabaseSync(path.join(dir,'borrow.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,item TEXT NOT NULL,borrower TEXT NOT NULL,contact TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',quantity INTEGER NOT NULL CHECK(quantity>0),borrow_date TEXT NOT NULL,due_date TEXT,returned_date TEXT,photo TEXT,thumb TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_dates ON records(returned_date,borrow_date);`);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function validate(b){
 const out={};
 for(const [k,max] of Object.entries({item:160,borrower:120,contact:160,description:2000})){out[k]=String(b[k]??'').trim();if(out[k].length>max)fail('ข้อความยาวเกินกำหนด');}
 if(!out.item||!out.borrower)fail('กรุณากรอกชื่อรายการและผู้ยืม');
 out.quantity=Number(b.quantity);if(!Number.isInteger(out.quantity)||out.quantity<1||out.quantity>100000)fail('จำนวนไม่ถูกต้อง');
 out.borrow_date=b.borrow_date;out.due_date=b.due_date||null;
 if(!dateOK(out.borrow_date)||out.due_date&&(!dateOK(out.due_date)||out.due_date<out.borrow_date))fail('วันที่ไม่ถูกต้อง หรือกำหนดคืนก่อนวันที่ยืม');
 return out;
}
function imageBytes(s,max){if(typeof s!=='string'||!s.startsWith('data:image/jpeg;base64,'))fail('รองรับรูป JPEG ที่ผ่านการย่อเท่านั้น');const b=Buffer.from(s.split(',')[1],'base64');if(b.length>max||b.length<4||b[0]!==255||b[1]!==216||b.at(-2)!==255||b.at(-1)!==217)fail('ไฟล์รูปไม่ถูกต้องหรือใหญ่เกินไป');return b;}
function photos(b){if(!b.image&&!b.thumbnail)return {};const full=imageBytes(b.image,700000),small=imageBytes(b.thumbnail,100000);const id=randomUUID();fs.writeFileSync(path.join(dir,'photos',id+'.jpg'),full);fs.writeFileSync(path.join(dir,'photos',id+'-t.jpg'),small);return {photo:id+'.jpg',thumb:id+'-t.jpg'};}
function removePhotos(r){for(const key of ['photo','thumb'])if(r?.[key])fs.rmSync(path.join(dir,'photos',r[key]),{force:true});}
async function body(req){let s='',size=0;for await(const chunk of req){size+=chunk.length;if(size>1200000)fail('ไฟล์ใหญ่เกินกำหนด',413);s+=chunk;}try{return JSON.parse(s);}catch{fail('ข้อมูลไม่ถูกต้อง');}}
const limits=new Map();
setInterval(()=>{const now=Date.now();for(const [k,v] of limits)if(v.until<now)limits.delete(k);},60000).unref();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
  const u=new URL(req.url,'http://local');
  if(req.method!=='GET'&&req.method!=='HEAD'){
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)fail('ไม่อนุญาตคำขอจากเว็บไซต์อื่น',403);
   if(!String(req.headers['content-type']).startsWith('application/json'))fail('ต้องส่ง JSON',415);
   const key=req.socket.remoteAddress;let l=limits.get(key);if(!l||l.until<Date.now()){l={count:0,until:Date.now()+60000};limits.set(key,l);}if(++l.count>120)fail('ส่งคำขอมากเกินไป กรุณารอสักครู่',429);
  }
  if(u.pathname==='/api/health'&&req.method==='GET'){db.prepare('SELECT 1').get();return json(200,{ok:true});}
  if(u.pathname==='/api/records'&&req.method==='GET'){
   const q=(u.searchParams.get('q')||'').slice(0,160),status=u.searchParams.get('status')||'active',page=Math.max(1,Math.min(100000,parseInt(u.searchParams.get('page'))||1));
   const archive=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
   const where={active:'returned_date IS NULL',overdue:'returned_date IS NULL AND due_date < ?',returned:'returned_date IS NOT NULL AND returned_date > ?',archived:'returned_date IS NOT NULL AND returned_date <= ?'}[status]||'1=1';
   const args=status==='overdue'?[today()]:['returned','archived'].includes(status)?[archive]:[];
   const filter=`(${where}) AND (instr(lower(item||' '||borrower||' '||contact||' '||description),lower(?))>0)`;args.push(q);
   const total=db.prepare(`SELECT count(*) n FROM records WHERE ${filter}`).get(...args).n;
   const rows=db.prepare(`SELECT * FROM records WHERE ${filter} ORDER BY borrow_date DESC,created_at DESC LIMIT 20 OFFSET ?`).all(...args,(page-1)*20);
   const counts=db.prepare('SELECT count(*) total,sum(returned_date IS NULL) active,sum(returned_date IS NULL AND due_date < ?) overdue,sum(returned_date IS NOT NULL) returned FROM records').get(today());
   return json(200,{rows,total,page,counts,today:today()});
  }
  if(u.pathname==='/api/records'&&req.method==='POST'){
   const b=await body(req),v=validate(b);if(!/^[0-9a-f-]{36}$/.test(b.id||''))fail('รหัสคำขอไม่ถูกต้อง');
   const existing=db.prepare('SELECT * FROM records WHERE id=?').get(b.id);if(existing)return json(200,existing);
   const p=photos(b);try{db.prepare('INSERT INTO records(id,item,borrower,contact,description,quantity,borrow_date,due_date,photo,thumb,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(b.id,v.item,v.borrower,v.contact,v.description,v.quantity,v.borrow_date,v.due_date,p.photo||null,p.thumb||null,new Date().toISOString());}catch(e){removePhotos(p);throw e;}
   return json(201,db.prepare('SELECT * FROM records WHERE id=?').get(b.id));
  }
  const match=u.pathname.match(/^\/api\/records\/([0-9a-f-]{36})$/);
  if(match&&req.method==='PATCH'){
   const b=await body(req),r=db.prepare('SELECT * FROM records WHERE id=?').get(match[1]);if(!r)fail('ไม่พบรายการ',404);if(b.version!==r.version)fail('รายการนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่',409);
   if(b.action==='return'||b.action==='reopen'){db.prepare('UPDATE records SET returned_date=?,version=version+1 WHERE id=?').run(b.action==='return'?today():null,r.id);}
   else{const v=validate(b),p=photos(b);try{db.prepare('UPDATE records SET item=?,borrower=?,contact=?,description=?,quantity=?,borrow_date=?,due_date=?,photo=?,thumb=?,version=version+1 WHERE id=?').run(v.item,v.borrower,v.contact,v.description,v.quantity,v.borrow_date,v.due_date,p.photo||r.photo,p.thumb||r.thumb,r.id);}catch(e){removePhotos(p);throw e;}if(p.photo)removePhotos(r);}
   return json(200,db.prepare('SELECT * FROM records WHERE id=?').get(r.id));
  }
  if(req.method!=='GET'&&req.method!=='HEAD')fail('ไม่รองรับคำขอนี้',405);
  let file,type;
  if(/^\/photos\/[0-9a-f-]+(?:-t)?\.jpg$/.test(u.pathname)){file=path.join(dir,u.pathname);type='image/jpeg';res.setHeader('Cache-Control','public,max-age=86400');}
  else{const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};const entry=files[u.pathname];if(!entry)fail('ไม่พบหน้า',404);file=path.join(root,'public',entry[0]);type=entry[1];res.setHeader('Cache-Control','no-cache');}
  if(!fs.existsSync(file))fail('ไม่พบไฟล์',404);res.writeHead(200,{'Content-Type':type});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)json(e.status||500,{error:e.status?e.message:'ระบบขัดข้อง กรุณาลองใหม่'});else res.end();if(!e.status)console.error(e);}
});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log('Borrow Mockup KC ready'));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
