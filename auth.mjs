import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const scrypt=promisify(derive), digest=s=>createHash('sha256').update(s).digest('hex');
export function setupAuth(db,dir){
 db.exec(`CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,employee_id TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,record_id TEXT NOT NULL,employee_id TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS activity_record ON activity(record_id,id);`);
 if(!db.prepare('PRAGMA table_info(records)').all().some(c=>c.name==='created_by'))db.exec('ALTER TABLE records ADD COLUMN created_by TEXT');
 const inviteFile=path.join(dir,'invitation-code');
 if(!fs.existsSync(inviteFile))fs.writeFileSync(inviteFile,randomBytes(18).toString('base64url'),{mode:0o600});
 const invite=(process.env.INVITATION_CODE||fs.readFileSync(inviteFile,'utf8')).trim();
 const attempts=new Map();let hashing=0;
 const error=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
 async function hash(password,salt){if(hashing>=4)error('ระบบกำลังทำงาน กรุณาลองอีกครั้ง',429);hashing++;try{return await scrypt(password,salt,64);}finally{hashing--;}}
 const publicUser=u=>u?{id:u.id,name:u.name,username:u.username}:null;
 function user(req){const token=(req.headers.cookie||'').match(/(?:^|;\s*)kc_session=([a-f0-9]{64})(?:;|$)/)?.[1];return token?db.prepare('SELECT e.* FROM sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires>?').get(digest(token),Date.now()):null;}
 function cookie(res,token,maxAge){res.setHeader('Set-Cookie',`kc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);}
 function session(res,u,remember){const token=randomBytes(32).toString('hex'),seconds=remember===true?30*86400:12*3600;db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),u.id,Date.now()+seconds*1000);cookie(res,token,seconds);}
 async function route(req,res,url,body,json){
  if(!url.startsWith('/api/auth/'))return false;
  if(url==='/api/auth/me'&&req.method==='GET'){json(200,{user:publicUser(user(req))});return true;}
  if(req.method!=='POST')error('ไม่พบหน้า',404);
  if(url==='/api/auth/logout'){const token=(req.headers.cookie||'').match(/kc_session=([a-f0-9]{64})/)?.[1];if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));cookie(res,'',0);json(200,{ok:true});return true;}
  if(!['/api/auth/login','/api/auth/register'].includes(url))error('ไม่พบหน้า',404);
  const b=await body(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
  if(!/^[a-z0-9._-]{3,40}$/.test(username)||password.length<10||password.length>128)error('ชื่อผู้ใช้ 3–40 ตัว (a-z, 0-9, . _ -) และรหัสผ่าน 10–128 ตัว');
  const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  for(const key of ['all',username]){let a=attempts.get(key);if(!a){a={n:0,until:now+15*60000};attempts.set(key,a);}if(++a.n>(key==='all'?100:10))error('ลองหลายครั้งเกินไป กรุณารอ 15 นาที',429);}
  let u;
  if(url.endsWith('/register')){
   if(!timingSafeEqual(Buffer.from(digest(String(b.invitation||''))),Buffer.from(digest(invite))))error('รหัสเชิญไม่ถูกต้อง',403);
   const name=String(b.name||'').trim();if(!name||name.length>120)error('กรุณากรอกชื่อพนักงานไม่เกิน 120 ตัว');
   if(db.prepare('SELECT id FROM employees WHERE username=?').get(username))error('ชื่อผู้ใช้นี้ถูกใช้แล้ว',409);
   const salt=randomBytes(16).toString('hex'),encoded=salt+':'+(await hash(password,salt)).toString('hex');
   u={id:randomUUID(),name,username};
   try{db.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run(u.id,name,username,encoded,new Date().toISOString());}catch(e){if(String(e.message).includes('UNIQUE'))error('ชื่อผู้ใช้นี้ถูกใช้แล้ว',409);throw e;}
  }else{
   u=db.prepare('SELECT * FROM employees WHERE username=?').get(username);
   const [salt,expected]=(u?.password||('0'.repeat(32)+':'+ '0'.repeat(128))).split(':');
   const computed=await hash(password,salt);
   if(!u||!timingSafeEqual(computed,Buffer.from(expected,'hex')))error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',401);
  }
  session(res,u,b.remember);json(200,{user:publicUser(u)});return true;
 }
 function audit(id,employee,action){db.prepare('INSERT INTO activity(record_id,employee_id,action,created_at) VALUES(?,?,?,?)').run(id,employee.id,action,new Date().toISOString());}
 function history(id){return db.prepare('SELECT a.action,a.created_at,e.id employee_id,e.name,e.username FROM activity a JOIN employees e ON e.id=a.employee_id WHERE a.record_id=? ORDER BY a.id DESC LIMIT 100').all(id);}
 function decorate(r){return {...r,creator:r.created_by?publicUser(db.prepare('SELECT * FROM employees WHERE id=?').get(r.created_by)):null};}
 return {user,route,audit,history,decorate};
}
