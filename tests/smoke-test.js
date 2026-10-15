const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const port = 4217 + Math.floor(Math.random()*1000);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ewan-clean-test-'));
const salt = crypto.randomBytes(16).toString('hex');
const passwordHash = crypto.scryptSync('TestAdminPass123', salt, 64).toString('hex');
const blank = { doctors:[], appointments:[], pharmacy:[], videoSessions:[], payments:[], users:[{id:'test-admin-id',username:'testadmin',name:'مدير اختبار',role:'admin',status:'approved',permissions:[],salt,passwordHash}], clinicalRecords:[], documents:[], notifications:[], audit:[], passwordOverrides:[] };
fs.writeFileSync(path.join(temp,'db.json'), JSON.stringify(blank,null,2));
const child = spawn(process.execPath, [path.join(__dirname,'..','server.js')], { env:{...process.env, PORT:String(port), HOST:'127.0.0.1', DATA_DIR:temp }, stdio:'ignore' });
function request(method, url, body, token) { return new Promise((resolve,reject)=>{ const data=body?Buffer.from(JSON.stringify(body)):null; const req=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{...(data?{'Content-Type':'application/json','Content-Length':data.length}:{}),...(token?{Authorization:'Bearer '+token}:{})}},res=>{let raw='';res.on('data',d=>raw+=d);res.on('end',()=>{let parsed;try{parsed=JSON.parse(raw)}catch{parsed=raw}resolve({status:res.statusCode,body:parsed,headers:res.headers})})});req.on('error',reject);if(data)req.write(data);req.end()}); }
(async()=>{
 try {
  let ready=false; for(let i=0;i<60;i++){try{const r=await request('GET','/api/health');if(r.status===200){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,100));} assert.ok(ready,'server starts');
  let r=await request('POST','/api/login',{username:'testadmin',password:'TestAdminPass123'});assert.equal(r.status,200,'admin can authenticate');const admin=r.body.token;
  r=await request('GET','/api/doctors',null,admin);assert.equal(r.status,200);assert.equal(r.body.length,0,'no demo doctors are seeded');
  r=await request('GET','/api/appointments',null,admin);assert.equal(r.status,200);assert.equal(r.body.length,0,'no demo appointments are seeded');
  r=await request('GET','/api/admin/backup',null,admin);assert.equal(r.status,200,'admin can export backup');assert.equal(r.body.format,'ewan-backup');const backup=r.body;assert.equal(backup.db.users.length,1,'backup contains the clean admin account');
  r=await request('POST','/api/register',{role:'patient',name:'مريض اختبار',username:'testpatient',password:'SafeTestPass123',phone:'01000000000',age:'30',birthDate:'1996-01-01',email:'patient@example.test'});assert.equal(r.status,201);assert.equal(r.body.pending,true);
  r=await request('POST','/api/login',{username:'testpatient',password:'SafeTestPass123'});assert.equal(r.status,403,'pending patient cannot log in');
  r=await request('GET','/api/users/pending',null,admin);const pending=r.body.find(u=>u.username==='testpatient');assert.ok(pending);r=await request('PATCH','/api/users/'+pending.id+'/approval',{status:'approved'},admin);assert.equal(r.status,200);
  r=await request('POST','/api/login',{username:'testpatient',password:'SafeTestPass123'});assert.equal(r.status,200);const patient=r.body.token;
  r=await request('GET','/api/admin/backup',null,patient);assert.equal(r.status,403,'non-admin cannot export backup');
  r=await request('POST','/api/admin/restore',{...backup,db:{...backup.db,users:[]}},admin);assert.equal(r.status,400,'restore validates that the active admin is included and does not blindly accept invalid snapshots');
  r=await request('POST','/api/admin/restore',backup,admin);assert.equal(r.status,200,'admin can restore a valid backup');
  r=await request('GET','/api/users',null,admin);assert.equal(r.status,200);assert.equal(r.body.length,1,'restore replaces current data with the selected backup');
  r=await request('GET','/api/admin/restore',null,patient);assert.equal(r.status,401,'restore requires correct method and auth');
  console.log('PASS: clean database, no demo doctors/appointments, admin authentication, registration approval, admin-only backup export, backup validation, and restore.');
 } catch(e){console.error('FAIL',e);process.exitCode=1} finally {child.kill();fs.rmSync(temp,{recursive:true,force:true});}
})();
