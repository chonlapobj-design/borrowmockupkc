// Older account data is retained only to display historical attribution.
export const issuers=['ขวัญ','เดือน','อาม','อ้น','จ๋า','จอย','เจน'];
export function setupRecords(db){
 db.exec(`CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,record_id TEXT NOT NULL,employee_id TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS activity_record ON activity(record_id,id);`);
 for(const column of ['created_by','issuer'])if(!db.prepare('PRAGMA table_info(records)').all().some(c=>c.name===column))db.exec(`ALTER TABLE records ADD COLUMN ${column} TEXT`);
 if(!db.prepare('PRAGMA table_info(activity)').all().some(c=>c.name==='issuer'))db.exec('ALTER TABLE activity ADD COLUMN issuer TEXT');
 return {
  audit(id,issuer,action){db.prepare('INSERT INTO activity(record_id,employee_id,action,created_at,issuer) VALUES(?,?,?,?,?)').run(id,'',action,new Date().toISOString(),issuer||null);},
  history(id){return db.prepare('SELECT a.action,a.created_at,a.issuer,e.name,e.username FROM activity a LEFT JOIN employees e ON e.id=a.employee_id WHERE a.record_id=? ORDER BY a.id DESC LIMIT 100').all(id);},
  decorate(r){return {...r,creator:r.created_by?db.prepare('SELECT name,username FROM employees WHERE id=?').get(r.created_by)||null:null};}
 };
}
