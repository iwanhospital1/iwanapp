const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
fs.mkdirSync(DATA_DIR, { recursive: true });

const initial = {
  doctors: [], appointments: [], pharmacy: [], videoSessions: [], payments: [],
  users: [], clinicalRecords: [], documents: [], notifications: [], audit: [], passwordOverrides: []
};
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
let db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const sessions = new Map();
function persist() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8'); }
if (!Array.isArray(db.users)) db.users = [];
if (!Array.isArray(db.payments)) db.payments = [];
if (!Array.isArray(db.videoSessions)) db.videoSessions = [];
if (!Array.isArray(db.clinicalRecords)) db.clinicalRecords = [];
if (!Array.isArray(db.documents)) db.documents = [];
if (!Array.isArray(db.notifications)) db.notifications = [];
if (!Array.isArray(db.passwordOverrides)) db.passwordOverrides = [];
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function verifyPassword(password, user) { if (user.passwordHash && user.salt) { const candidate = crypto.scryptSync(password, user.salt, 64); const expected = Buffer.from(user.passwordHash, 'hex'); return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected); } return user.password === password; }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
function audit(user, action, target) { db.audit.unshift({ id: crypto.randomUUID(), user: user?.username || 'system', role: user?.role || 'system', action, target, at: new Date().toISOString() }); db.audit = db.audit.slice(0, 500); persist(); }
function getUser(req) { const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); return sessions.get(token) || null; }
function requireRole(req, res, roles) { const user = getUser(req); if (!user) { json(res, 401, { error: 'يلزم تسجيل الدخول' }); return null; } if (roles && !roles.includes(user.role)) { json(res, 403, { error: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' }); return null; } return user; }
function readBody(req, maxBytes = 3_000_000) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > maxBytes) { reject(new Error('حجم الطلب كبير')); req.destroy(); } }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('صيغة JSON غير صحيحة')); } }); req.on('error', reject); }); }
function makeSlots(start='09:00', end='17:00', duration=60) { const toMin=t=>{const [h,m]=String(t||'').split(':').map(Number);return h*60+m}; const a=toMin(start), z=toMin(end); if(!Number.isFinite(a)||!Number.isFinite(z)||z<=a||duration<15||duration>240)return []; const out=[]; for(let m=a;m+duration<=z;m+=duration)out.push(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')); return out; }
function doctorNameFor(id) { return db.doctors.find(d => d.id === id)?.name || 'الطبيب المعالج'; }
function safeUser(user) { const { password, passwordHash, salt, ...rest } = user; return rest; }
const defaultPermissions = { admin: ['home','appointments','doctors','accounts','finance','medical','pharmacy','video','audit','notifications','schedule','mySessions'], doctor: ['home','appointments','schedule','medical','mySessions','video','notifications'], patient: ['home','appointments','doctors','medical','notifications'], staff: ['home','appointments','notifications'], accounting: ['home','appointments','finance','notifications'], pharmacy: ['home','pharmacy','notifications'] };
function canAccess(user, permission) { return user.role === 'admin' || (Array.isArray(user.permissions) ? user.permissions.includes(permission) : (defaultPermissions[user.role] || []).includes(permission)); }
function notify(recipientId, title, message, appointmentId) { if (!recipientId) return; db.notifications.unshift({id:crypto.randomUUID(),recipientId,title,message,appointmentId,createdAt:new Date().toISOString(),read:false}); }
function sendFile(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(PUBLIC, '.' + pathname);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) return json(res, 403, { error: 'ممنوع' });
  fs.readFile(file, (err, bytes) => {
    if (err) return json(res, 404, { error: 'الملف غير موجود' });
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
    res.end(bytes);
  });
}
const app = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, app: 'Ewan Hospital', mode: 'clean-test' , timestamp: new Date().toISOString() });
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const body = await readBody(req);
      const name = String(body.name || '').trim(); const username = String(body.username || '').trim().toLowerCase(); const password = String(body.password || '');
      const role = ['patient','doctor','staff'].includes(body.role) ? body.role : 'patient';
      if (name.length < 2 || username.length < 4 || !/^[a-z0-9._-]+$/.test(username) || password.length < 10) return json(res, 400, { error: 'أدخل الاسم، واسم مستخدم من 4 أحرف على الأقل وكلمة مرور 10 أحرف على الأقل' });
      if (db.users.some(u => u.username.toLowerCase() === username)) return json(res, 409, { error: 'اسم المستخدم مستخدم بالفعل' });
      if (!body.phone) return json(res, 400, { error: 'رقم الموبايل مطلوب' });
      if (role === 'doctor' && (!body.specialty || !body.age || !body.feeEgyptian || !body.feeForeign || !body.weeklySchedule)) return json(res, 400, { error: 'بيانات الطبيب والتخصص والأسعار والجدول الأسبوعي مطلوبة' });
      if (role === 'patient' && (!body.birthDate || !body.email)) return json(res, 400, { error: 'تاريخ الميلاد والبريد الإلكتروني مطلوبان للمريض' });
      if (role === 'staff' && (!body.fingerprint || !body.department)) return json(res, 400, { error: 'رقم البصمة والقسم مطلوبان للموظف' });
      const hashed = hashPassword(password);
      const created = { id: crypto.randomUUID(), username, name: name.slice(0,100), role, status: 'pending', permissions: [], phone: String(body.phone).slice(0,30), createdAt: new Date().toISOString(), ...{ passwordHash: hashed.hash, salt: hashed.salt } };
      for (const k of ['age','birthDate','email','specialty','feeEgyptian','feeForeign','weeklySchedule','certificates','fingerprint','department']) if (body[k] !== undefined) created[k] = body[k];
      if (typeof created.weeklySchedule === 'string') { try { created.weeklySchedule = JSON.parse(created.weeklySchedule); } catch { created.weeklySchedule = {}; } }
      if (role === 'doctor') created.doctorId = 'pending-' + created.id;
      db.users.push(created); persist(); audit(created, 'account.register.pending', created.id);
      return json(res, 201, { pending: true, message: 'تم استلام طلبك. لن تتمكن من الدخول قبل مراجعة الإدارة والموافقة على الحساب.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req); const username = String(body.username || '').trim(); const password = String(body.password || '');
      const found = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() && verifyPassword(password, u));
      if (!found) return json(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
      if (found.status === 'pending') return json(res, 403, { error: 'حسابك قيد مراجعة الإدارة. يمكنك الدخول بعد الموافقة.' });
      if (found.status === 'rejected') return json(res, 403, { error: 'تم رفض طلب الحساب. تواصل مع إدارة المستشفى.' });
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, safeUser(found)); audit(found, 'login', 'session');
      return json(res, 200, { token, user: safeUser(found) });
    }
    const user = getUser(req);
    if (req.method === 'GET' && url.pathname === '/api/me') {
      if (!user) return json(res, 401, { error: 'يلزم تسجيل الدخول' });
      return json(res, 200, { user });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (user) audit(user, 'logout', 'session'); sessions.delete(token); return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!user) return json(res, 401, { error: 'يلزم تسجيل الدخول' });
      if (url.pathname === '/api/admin/backup' && req.method === 'GET') {
        if (user.role !== 'admin') return json(res, 403, { error: 'النسخ الاحتياطي للأدمن فقط' });
        audit(user, 'backup.export', 'full-database');
        return json(res, 200, { format: 'ewan-backup', version: 1, exportedAt: new Date().toISOString(), app: 'Ewan Hospital', db });
      }
      if (url.pathname === '/api/admin/restore' && req.method === 'POST') {
        if (user.role !== 'admin') return json(res, 403, { error: 'استعادة النسخة الاحتياطية للأدمن فقط' });
        const b = await readBody(req, 25_000_000);
        if (!b || b.format !== 'ewan-backup' || b.version !== 1 || !b.db || typeof b.db !== 'object') return json(res, 400, { error: 'ملف النسخة الاحتياطية غير صالح أو غير مدعوم' });
        const requiredArrays = ['doctors','appointments','pharmacy','videoSessions','payments','users','clinicalRecords','documents','notifications','audit'];
        if (requiredArrays.some(k => !Array.isArray(b.db[k]))) return json(res, 400, { error: 'النسخة الاحتياطية ناقصة أو تالفة؛ لم يتم تغيير البيانات' });
        if (!b.db.users.some(u => u.id === user.id && u.role === 'admin')) return json(res, 400, { error: 'النسخة لا تحتوي على حساب الأدمن الحالي؛ لم يتم تغيير البيانات' });
        const safeDb = {};
        for (const k of requiredArrays) safeDb[k] = b.db[k];
        safeDb.passwordOverrides = Array.isArray(b.db.passwordOverrides) ? b.db.passwordOverrides : [];
        db = safeDb; persist();
        for (const [token, activeUser] of sessions) if (activeUser.id !== user.id) sessions.delete(token);
        audit(user, 'backup.restore', String(b.exportedAt || 'unknown'));
        return json(res, 200, { ok: true, message: 'تمت استعادة النسخة الاحتياطية بنجاح' });
      }
      if (url.pathname === '/api/notifications' && req.method === 'GET') { if(!canAccess(user,'notifications')) return json(res,403,{error:'الأدمن لم يمنحك صلاحية الإشعارات'}); const rows=(db.notifications||[]).filter(n=>n.recipientId===user.id); return json(res,200,rows.slice(0,100)); }
      if (url.pathname === '/api/notifications/read-all' && req.method === 'POST') { for (const n of (db.notifications||[])) if(n.recipientId===user.id)n.read=true; persist(); return json(res,200,{ok:true}); }
      if (url.pathname === '/api/users/pending') {
        if (user.role !== 'admin') return json(res, 403, { error: 'هذه الوظيفة للأدمن فقط' });
        if (req.method === 'GET') return json(res, 200, db.users.filter(u => ['pending','rejected','approved'].includes(u.status)).map(safeUser));
      }
      if (url.pathname === '/api/users' && req.method === 'GET') {
        if (user.role !== 'admin') return json(res, 403, { error: 'عرض المستخدمين للأدمن فقط' });
        return json(res, 200, db.users.map(u => ({...safeUser(u), permissions: Array.isArray(u.permissions) ? u.permissions : (defaultPermissions[u.role] || [])})));
      }
      const passwordMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/password$/);
      if (req.method === 'PATCH' && passwordMatch) {
        if (user.role !== 'admin') return json(res, 403, { error: 'تغيير كلمات المرور من صلاحية الأدمن فقط' });
        const b = await readBody(req); const newPassword = String(b.password || '');
        if (newPassword.length < 10) return json(res, 400, { error: 'كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف' });
        const targetId = passwordMatch[1]; const target = db.users.find(u => u.id === targetId);
        if (!target) return json(res, 404, { error: 'الحساب غير موجود' });
        if (target.role === 'admin' && target.id !== user.id) return json(res, 403, { error: 'لا يمكن تغيير كلمة مرور مدير آخر من هذه الشاشة' });
        const hashed = hashPassword(newPassword); target.passwordHash = hashed.hash; target.salt = hashed.salt; delete target.password;
        persist();
        for (const [token, activeUser] of sessions) if (activeUser.id === targetId) sessions.delete(token);
        audit(user, 'user.password.reset', targetId);
        return json(res, 200, { ok: true, message: 'تم تغيير كلمة المرور. يجب على المستخدم تسجيل الدخول بكلمة المرور الجديدة.' });
      }
      const permissionsMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/permissions$/);
      if (req.method === 'PATCH' && permissionsMatch) {
        if (user.role !== 'admin') return json(res, 403, { error: 'تعديل الصلاحيات للأدمن فقط' });
        const target = db.users.find(u => u.id === permissionsMatch[1]); if (!target) return json(res, 404, {error:'الحساب غير موجود'});
        const b = await readBody(req); const allowed = ['home','appointments','doctors','accounts','finance','medical','pharmacy','video','audit','notifications','schedule','mySessions'];
        if (!Array.isArray(b.permissions) || b.permissions.some(x => !allowed.includes(x))) return json(res, 400, {error:'قائمة الصلاحيات غير صحيحة'});
        target.permissions = [...new Set(b.permissions)]; for (const [token, activeUser] of sessions) if (activeUser.id === target.id) sessions.set(token, safeUser(target)); persist(); audit(user,'user.permissions.update',target.id); return json(res,200,{id:target.id,permissions:target.permissions});
      }
      const approvalMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/approval$/);
      if (req.method === 'PATCH' && approvalMatch) {
        if (user.role !== 'admin') return json(res, 403, { error: 'هذه الوظيفة للأدمن فقط' });
        const b = await readBody(req); const target = db.users.find(u => u.id === approvalMatch[1]);
        if (!target) return json(res, 404, { error: 'الحساب غير موجود' });
        if (!['approved','rejected'].includes(b.status)) return json(res, 400, { error: 'حالة الموافقة غير صحيحة' });
        target.status = b.status; if (b.status === 'approved' && (!Array.isArray(target.permissions) || target.permissions.length === 0)) target.permissions = defaultPermissions[target.role] || []; target.reviewedAt = new Date().toISOString(); target.reviewedBy = user.username; target.reviewNote = String(b.note || '').slice(0,500);
        if (target.role === 'doctor' && b.status === 'approved') {
          let doctor = db.doctors.find(d => d.userId === target.id);
          if (!doctor) { doctor = { id: crypto.randomUUID(), userId: target.id, name: target.name, specialty: target.specialty, fee: Number(target.feeEgyptian || 500), feeEgyptian: Number(target.feeEgyptian || 500), feeForeign: Number(target.feeForeign || 1000), active: true, weeklySchedule: target.weeklySchedule || {} }; db.doctors.push(doctor); target.doctorId = doctor.id; }
        }
        persist(); audit(user, 'account.' + b.status, target.id); return json(res, 200, safeUser(target));
      }
      if (url.pathname === '/api/doctor/schedule') {
        if (!canAccess(user,'schedule')) return json(res,403,{error:'الأدمن لم يمنحك صلاحية جدول الطبيب'});
        if (!['doctor','admin'].includes(user.role)) return json(res, 403, { error: 'جدول العمل للطبيب أو الإدارة فقط' });
        const profile = db.users.find(u => u.id === user.id);
        const targetId = user.role === 'doctor' ? (user.doctorId || profile?.doctorId) : url.searchParams.get('doctorId');
        let doctor = db.doctors.find(d => d.id === targetId) || (profile && db.doctors.find(d => d.userId === profile.id));
        if (!doctor && user.role === 'doctor') {
          doctor = db.doctors.find(d => d.name === user.name) || null;
          if (doctor && profile) { doctor.userId = profile.id; profile.doctorId = doctor.id; }
        }
        if (req.method === 'GET') return json(res, 200, { weeklySchedule: doctor?.weeklySchedule || profile?.weeklySchedule || {}, doctorId: doctor?.id || targetId || null });
        if (req.method === 'PUT') {
          const b = await readBody(req); const schedule = b.weeklySchedule;
          if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return json(res, 400, { error: 'الجدول الأسبوعي مطلوب' });
          for (const [day, v] of Object.entries(schedule)) { if (!/^[0-6]$/.test(day) || !v || typeof v.enabled !== 'boolean') return json(res,400,{error:'بيانات أحد أيام الأسبوع غير صحيحة'}); if (v.enabled && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.end) || v.end <= v.start || ![30,45,60,90,120].includes(Number(v.duration)))) return json(res,400,{error:'راجع أوقات البداية والنهاية ومدة الجلسة'}); }
          if (doctor) doctor.weeklySchedule = schedule; if (profile) profile.weeklySchedule = schedule;
          if (!doctor && user.role === 'doctor') return json(res,404,{error:'لم يتم ربط حساب الطبيب بملف طبيب. تواصل مع الأدمن لمراجعة الحساب.'});
          persist(); audit(user, 'doctor.schedule.update', doctor?.id || targetId || user.id); return json(res, 200, { weeklySchedule: schedule });
        }
      }
      if (url.pathname === '/api/documents') {
        if (!canAccess(user,'medical')) return json(res,403,{error:'الأدمن لم يمنحك صلاحية الملفات الطبية'});
        if (!['patient','doctor','admin'].includes(user.role)) return json(res, 403, { error: 'ليس لديك صلاحية للملفات الطبية' });
        if (req.method === 'GET') { let rows = db.documents || []; if (user.role === 'patient') rows = rows.filter(d => d.patientUserId === user.id); else if (user.role === 'doctor') { const patientIds = db.appointments.filter(a=>a.doctorId===user.doctorId).map(a=>a.patientUserId); rows = rows.filter(d => d.doctorId === user.doctorId || patientIds.includes(d.patientUserId)); } return json(res, 200, rows.map(({dataBase64, ...meta}) => ({...meta, dataBase64: ['patient','doctor','admin'].includes(user.role) ? dataBase64 : undefined}))); }
        if (req.method === 'POST') { if (user.role !== 'patient') return json(res, 403, { error: 'المريض هو من يرفع ملفاته في هذه النسخة' }); const b = await readBody(req); const name = String(b.name || '').slice(0,150); const mime = String(b.mime || 'application/octet-stream'); const data = String(b.dataBase64 || ''); if (!name || !data || data.length > 1800000 || !/^data:(application\/pdf|image\/(png|jpeg|webp));base64,/.test(data)) return json(res, 400, { error: 'ارفع صورة PNG/JPG/WEBP أو ملف PDF أقل من 1.3 ميجابايت' }); if (!Array.isArray(db.documents)) db.documents = []; const doc = { id: crypto.randomUUID(), patientUserId: user.id, patientName: user.name, name, mime, dataBase64: data, createdAt: new Date().toISOString() }; db.documents.push(doc); persist(); audit(user, 'medical-document.upload', doc.id); return json(res, 201, { id: doc.id, name: doc.name, createdAt: doc.createdAt }); }
      }
      if (url.pathname === '/api/clinical-records') {
        if (!['doctor','admin','patient'].includes(user.role)) return json(res, 403, { error: 'ليس لديك صلاحية للملف الطبي' });
        if (req.method === 'GET') { const apptId = url.searchParams.get('appointmentId'); const patientId = url.searchParams.get('patientUserId'); let rows = db.clinicalRecords; if (user.role === 'patient') rows = rows.filter(r => r.patientUserId === user.id); else if (user.role === 'doctor') rows = rows.filter(r => r.doctorId === user.doctorId); if (apptId) rows = rows.filter(r => r.appointmentId === apptId); if (patientId && user.role === 'admin') rows = rows.filter(r => r.patientUserId === patientId); return json(res, 200, rows); }
        if (req.method === 'POST') { if (user.role !== 'doctor' && user.role !== 'admin') return json(res, 403, { error: 'الطبيب فقط يمكنه كتابة ملاحظات الجلسة' }); const b = await readBody(req); const appt = db.appointments.find(a => a.id === b.appointmentId); if (!appt || (user.role === 'doctor' && appt.doctorId !== user.doctorId)) return json(res, 404, { error: 'الحجز غير موجود أو غير مصرح به' }); const record = { id: crypto.randomUUID(), appointmentId: appt.id, patientUserId: appt.patientUserId || null, doctorId: appt.doctorId, doctorName: doctorNameFor(appt.doctorId), summary: String(b.summary || '').slice(0,5000), medications: String(b.medications || '').slice(0,5000), instructions: String(b.instructions || '').slice(0,5000), createdAt: new Date().toISOString(), createdBy: user.username }; db.clinicalRecords.push(record); persist(); audit(user, 'clinical-record.create', record.id); return json(res, 201, record); }
      }
      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        if (!['admin', 'doctor'].includes(user.role)) return json(res, 403, { error: 'ليس لديك صلاحية' });
        return json(res, 200, { doctors: db.doctors.length, appointments: db.appointments.length, pending: db.appointments.filter(a => a.status === 'بانتظار التأكيد').length, pharmacyLow: db.pharmacy.filter(m => m.stock <= m.minStock).length, recentAppointments: db.appointments.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,6) });
      }
      if (req.method === 'GET' && url.pathname === '/api/doctors') { if(!canAccess(user,'doctors')) return json(res,403,{error:'الأدمن لم يمنحك صلاحية قائمة الأطباء'}); return json(res, 200, db.doctors.filter(d => d.active)); }
      if (req.method === 'GET' && url.pathname === '/api/availability') {
        const doctorId = url.searchParams.get('doctorId'); const date = url.searchParams.get('date');
        const doctor = db.doctors.find(d => d.id === doctorId && d.active); if (!doctor || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return json(res, 400, { error: 'اختر الطبيب وتاريخًا صحيحًا' });
        const booked = db.appointments.filter(a => a.doctorId === doctorId && a.date === date && !['ملغي','فشل الدفع'].includes(a.status)).map(a => a.time);
        const weekday = String(new Date(date + 'T12:00:00').getDay()); const scheduleDay = doctor.weeklySchedule?.[weekday]; const generated = scheduleDay?.enabled ? makeSlots(scheduleDay.start, scheduleDay.end, Number(scheduleDay.duration || 60)) : null; const allSlots = doctor.weeklySchedule ? (scheduleDay?.enabled ? (generated || []) : []) : (doctor.slots || ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00']);
        const today = new Date().toISOString().slice(0,10); const nowTime = new Date().toISOString().slice(11,16);
        const slots = allSlots.filter(t => !booked.includes(t) && (date > today || (date === today && t > nowTime)));
        const patient = user.role === 'patient' ? db.users.find(u=>u.id===user.id) : null; const fee = patient?.nationality === 'foreign' ? Number(doctor.feeForeign || doctor.fee || 500) : Number(doctor.feeEgyptian || doctor.fee || 500); return json(res, 200, { doctorId, date, fee, slots });
      }
      const doctorMatch = url.pathname.match(/^\/api\/doctors\/([^/]+)$/);
      if (req.method === 'PATCH' && doctorMatch) {
        if (user.role !== 'admin') return json(res, 403, { error: 'تعديل بيانات الطبيب للأدمن فقط' });
        const b = await readBody(req); const d = db.doctors.find(x => x.id === doctorMatch[1]); if (!d) return json(res, 404, { error: 'الطبيب غير موجود' });
        if (b.name !== undefined) d.name = String(b.name).slice(0,100); if (b.specialty !== undefined) d.specialty = String(b.specialty).slice(0,120);
        if (b.feeEgyptian !== undefined) { const n=Number(b.feeEgyptian); if(!Number.isFinite(n)||n<0)return json(res,400,{error:'سعر المصريين غير صحيح'}); d.feeEgyptian=n; d.fee=n; }
        if (b.feeForeign !== undefined) { const n=Number(b.feeForeign); if(!Number.isFinite(n)||n<0)return json(res,400,{error:'سعر غير المصريين غير صحيح'}); d.feeForeign=n; }
        persist(); audit(user,'doctor.update',d.id); return json(res,200,d);
      }
      if (req.method === 'POST' && url.pathname === '/api/doctors') {
        if (user.role !== 'admin') return json(res, 403, { error: 'هذه الوظيفة للمدير فقط' });
        const b = await readBody(req); if (!b.name || !b.specialty) return json(res, 400, { error: 'الاسم والتخصص مطلوبان' });
        const d = { id: crypto.randomUUID(), name: String(b.name).slice(0,100), specialty: String(b.specialty).slice(0,120), active: true }; db.doctors.push(d); persist(); audit(user, 'doctor.create', d.id); return json(res, 201, d);
      }
      if (req.method === 'GET' && url.pathname === '/api/appointments') {
        if (!canAccess(user,'appointments')) return json(res,403,{error:'الأدمن لم يمنحك صلاحية عرض المواعيد'});
        if (user.role === 'pharmacy') return json(res, 403, { error: 'ليس لديك صلاحية' });
        let list = db.appointments;
        if (user.role === 'patient') list = list.filter(a => a.patientUserId === user.id);
        if (user.role === 'doctor') list = list.filter(a => a.doctorId === user.doctorId);
        return json(res, 200, list.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)));
      }
      if (req.method === 'POST' && url.pathname === '/api/appointments') {
        if (!canAccess(user,'appointments')) return json(res,403,{error:'الأدمن لم يمنحك صلاحية الحجوزات'});
        if (!['admin', 'patient', 'doctor'].includes(user.role)) return json(res, 403, { error: 'ليس لديك صلاحية' });
        const b = await readBody(req);
        const doctor = db.doctors.find(d => d.id === b.doctorId && d.active);
        if (!doctor || !b.date || !b.time || !b.service) return json(res, 400, { error: 'اختر الطبيب والخدمة والتاريخ والوقت' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) return json(res, 400, { error: 'التاريخ أو الوقت غير صحيح' });
        const collision = db.appointments.some(a => a.doctorId === b.doctorId && a.date === b.date && a.time === b.time && !['ملغي','فشل الدفع'].includes(a.status));
        if (collision) return json(res, 409, { error: 'الموعد محجوز بالفعل، اختر وقتًا آخر' });
        const mode = ['online','in_person'].includes(b.sessionType) ? b.sessionType : 'online';
        const a = { id: crypto.randomUUID(), patientName: user.role === 'patient' ? user.name : String(b.patientName || 'مريض تجريبي').slice(0,100), patientPhone: user.role === 'patient' ? '' : String(b.patientPhone || '').slice(0,30), patientUserId: user.role === 'patient' ? user.id : null, doctorId: doctor.id, service: String(b.service).slice(0,100), date: b.date, time: b.time, sessionType: mode, fee: Number((db.users.find(u=>u.id===user.id)?.nationality === 'foreign') ? (doctor.feeForeign || doctor.fee || 500) : (doctor.feeEgyptian || doctor.fee || 500)), paymentStatus: user.role === 'patient' ? 'unpaid' : 'not_required_demo', status: user.role === 'patient' ? 'بانتظار الدفع' : 'بانتظار التأكيد', createdAt: new Date().toISOString() };
        db.appointments.push(a); if (!Array.isArray(db.notifications)) db.notifications = [];
if (!Array.isArray(db.passwordOverrides)) db.passwordOverrides = [];
if(user.role==='patient') notify(user.id,'تم استلام طلب الحجز','طلب حجزك بتاريخ '+a.date+' الساعة '+a.time+' في انتظار مراجعة الاستقبال.',a.id); const doctorUser = db.users.find(u => u.role === 'doctor' && u.doctorId === doctor.id); if (doctorUser) notify(doctorUser.id,'حجز جديد','طلب حجز جديد بتاريخ '+a.date+' الساعة '+a.time+'. يمكنك تأكيده أو طلب تأجيله أو إلغاؤه.',a.id); for (const staffUser of db.users.filter(u=>u.role==='staff'&&u.status==='approved')) notify(staffUser.id,'حجز يحتاج مراجعة','يوجد حجز جديد يحتاج إلى مراجعة الاستقبال.',a.id); persist(); audit(user, 'appointment.create', a.id); return json(res, 201, a);
      }
      const respondMatch = url.pathname.match(/^\/api\/appointments\/([^/]+)\/respond$/);
      if (req.method === 'POST' && respondMatch) {
        if (user.role !== 'doctor') return json(res,403,{error:'استجابة الطبيب للحجز متاحة للطبيب المعالج فقط'});
        const a = db.appointments.find(x=>x.id===respondMatch[1]); if(!a || a.doctorId!==user.doctorId) return json(res,404,{error:'الحجز غير موجود ضمن مواعيدك'});
        const b = await readBody(req); const allowed = ['confirm','reschedule','cancel']; if(!allowed.includes(b.action)) return json(res,400,{error:'اختر تأكيد أو طلب تأجيل أو إلغاء'});
        const patientId=a.patientUserId; const staff=db.users.filter(u=>u.role==='staff'&&u.status==='approved');
        if(b.action==='confirm'){a.status='مؤكد'; notify(patientId,'تم تأكيد موعدك','أكد الطبيب موعدك يوم '+a.date+' الساعة '+a.time,a.id); staff.forEach(u=>notify(u.id,'تم تأكيد حجز','أكد الطبيب الحجز '+a.id,a.id));}
        if(b.action==='cancel'){a.status='طلب إلغاء من الطبيب'; notify(patientId,'طلب إلغاء موعد','طلب الطبيب إلغاء الموعد، والاستقبال سيتابع معك.',a.id); staff.forEach(u=>notify(u.id,'طلب إلغاء حجز','الطبيب طلب إلغاء الحجز '+a.id,a.id));}
        if(b.action==='reschedule'){const date=String(b.date||'');const time=String(b.time||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return json(res,400,{error:'حدد التاريخ والوقت المقترحين'});a.status='طلب تأجيل من الطبيب';a.rescheduleProposal={date,time,by:user.id,at:new Date().toISOString()};notify(patientId,'اقتراح موعد بديل','اقترح الطبيب موعدًا بديلًا: '+date+' الساعة '+time+'. تواصل مع الاستقبال لتأكيده.',a.id);staff.forEach(u=>notify(u.id,'طلب تأجيل حجز','اقترح الطبيب موعدًا بديلًا للحجز '+a.id+': '+date+' '+time,a.id));}
        persist();audit(user,'appointment.doctor_response',a.id+':'+b.action);return json(res,200,a);
      }
      const apptMatch = url.pathname.match(/^\/api\/appointments\/([^/]+)$/);
      if (req.method === 'PATCH' && apptMatch) {
        if (!['admin', 'doctor', 'staff'].includes(user.role)) return json(res, 403, { error: 'الإدارة والاستقبال والطبيب فقط يمكنهم تعديل حالة الحجز' });
        const b = await readBody(req); const a = db.appointments.find(x => x.id === apptMatch[1]); if (!a) return json(res, 404, { error: 'الحجز غير موجود' });
        if (user.role === 'doctor' && a.doctorId !== user.doctorId) return json(res, 403, { error: 'هذا الحجز ليس ضمن مواعيدك' });
        if (!['مؤكد', 'بانتظار التأكيد', 'ملغي', 'تمت الزيارة'].includes(b.status)) return json(res, 400, { error: 'حالة غير صحيحة' });
        a.status = b.status; persist(); audit(user, 'appointment.status', a.id + ':' + a.status); return json(res, 200, a);
      }
      if (url.pathname === '/api/payments') {
        if (req.method === 'GET') {
          const list = user.role === 'admin' ? db.payments : db.payments.filter(p => p.patientUserId === user.id);
          if (!['admin','patient'].includes(user.role)) return json(res, 403, { error: 'ليس لديك صلاحية لعرض المدفوعات' });
          return json(res, 200, list.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/payments/test-intent') {
        if (user.role !== 'patient') return json(res, 403, { error: 'الدفع التجريبي متاح لحساب المريض فقط' });
        const b = await readBody(req); const appointment = db.appointments.find(a => a.id === b.appointmentId && a.patientUserId === user.id);
        if (!appointment) return json(res, 404, { error: 'الحجز غير موجود لهذا الحساب' });
        if (appointment.paymentStatus === 'paid') return json(res, 409, { error: 'تم دفع هذا الحجز بالفعل' });
        if (appointment.status === 'ملغي') return json(res, 409, { error: 'الحجز ملغي' });
        let payment = db.payments.find(p => p.appointmentId === appointment.id && p.status === 'pending');
        if (!payment) { payment = { id: crypto.randomUUID(), reference: 'TEST-' + crypto.randomBytes(5).toString('hex').toUpperCase(), appointmentId: appointment.id, patientUserId: user.id, amount: appointment.fee, currency: 'EGP', provider: 'mock-test', mode: 'TEST_ONLY_NO_REAL_MONEY', status: 'pending', createdAt: new Date().toISOString() }; db.payments.push(payment); persist(); audit(user, 'payment.test_intent', payment.id); }
        return json(res, 201, payment);
      }
      if (req.method === 'POST' && url.pathname === '/api/payments/test-confirm') {
        if (user.role !== 'patient') return json(res, 403, { error: 'الدفع التجريبي متاح لحساب المريض فقط' });
        const b = await readBody(req); const payment = db.payments.find(p => p.id === b.paymentId && p.patientUserId === user.id);
        if (!payment) return json(res, 404, { error: 'عملية الدفع غير موجودة' });
        if (payment.status !== 'pending') return json(res, 409, { error: 'تمت معالجة عملية الدفع من قبل' });
        const appointment = db.appointments.find(a => a.id === payment.appointmentId);
        if (!appointment) return json(res, 404, { error: 'الحجز المرتبط غير موجود' });
        if (b.result === 'success') { payment.status = 'paid_test'; payment.completedAt = new Date().toISOString(); appointment.paymentStatus = 'paid_test'; appointment.status = 'مؤكد (اختبار الدفع)'; }
        else { payment.status = 'failed_test'; payment.completedAt = new Date().toISOString(); appointment.paymentStatus = 'failed_test'; appointment.status = 'ملغي'; }
        persist(); audit(user, 'payment.test_result', payment.id + ':' + payment.status);
        return json(res, 200, { payment, appointment, notice: 'وضع اختبار فقط: لم يتم تحصيل أي أموال حقيقية.' });
      }
      if (url.pathname === '/api/pharmacy') {
        if (!canAccess(user,'pharmacy')) return json(res,403,{error:'الأدمن لم يمنحك صلاحية الصيدلية'});
        if (!['admin', 'pharmacy'].includes(user.role)) return json(res, 403, { error: 'هذه البيانات للصيدلية والإدارة فقط' });
        if (req.method === 'GET') return json(res, 200, db.pharmacy);
        if (req.method === 'POST') {
          if (user.role !== 'admin') return json(res, 403, { error: 'إضافة الأصناف للمدير فقط في هذه النسخة' });
          const b = await readBody(req); const stock = Number(b.stock); const minStock = Number(b.minStock || 0);
          if (!b.name || !Number.isFinite(stock) || stock < 0 || !Number.isFinite(minStock) || minStock < 0) return json(res, 400, { error: 'راجع اسم الصنف والكمية' });
          const item = { id: crypto.randomUUID(), name: String(b.name).slice(0,100), stock, minStock, unit: String(b.unit || 'وحدة').slice(0,30), category: String(b.category || 'عام').slice(0,60) }; db.pharmacy.push(item); persist(); audit(user, 'pharmacy.item.create', item.id); return json(res, 201, item);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/video-sessions') {
        if (!['admin', 'doctor'].includes(user.role)) return json(res, 403, { error: 'الطبيب أو الإدارة فقط يمكنهما تجهيز جلسة' });
        const b = await readBody(req); if (!b.appointmentId) return json(res, 400, { error: 'رقم الحجز مطلوب' });
        const a = db.appointments.find(x => x.id === b.appointmentId); if (!a || (user.role === 'doctor' && a.doctorId !== user.doctorId)) return json(res, 404, { error: 'الحجز غير موجود أو غير مصرح به' });
        const meetingRoom = 'ewan-test-' + crypto.randomUUID().replace(/-/g,''); const s = { id: crypto.randomUUID(), appointmentId: a.id, status: 'test_link_only', meetingUrl: 'https://meet.jit.si/' + meetingRoom, warning: 'رابط اختبار عام فقط؛ ممنوع استخدامه مع بيانات أو جلسات مرضى حقيقية.', createdAt: new Date().toISOString() }; db.videoSessions.push(s); persist(); audit(user, 'video-session.prepare', s.id); return json(res, 201, s);
      }
      if (req.method === 'GET' && url.pathname === '/api/audit') { if (user.role !== 'admin') return json(res, 403, { error: 'سجل العمليات للمدير فقط' }); return json(res, 200, db.audit.slice(0,200)); }
      return json(res, 404, { error: 'مسار API غير موجود' });
    }
    return sendFile(req, res);
  } catch (e) { console.error(e); return json(res, 400, { error: e.message || 'حدث خطأ في الطلب' }); }
});
// Local reminder runner: creates in-app reminders about 30 minutes before confirmed sessions.
function sendSessionReminders() {
  const now = Date.now();
  for (const a of db.appointments) {
    if (!['مؤكد','مؤكد (اختبار الدفع)'].includes(a.status) || a.reminderSentAt) continue;
    const startsAt = new Date(`${a.date}T${a.time}:00`).getTime();
    const minutes = (startsAt - now) / 60000;
    if (Number.isFinite(minutes) && minutes <= 30 && minutes > 28) {
      const doctorUser = db.users.find(u=>u.role==='doctor'&&u.doctorId===a.doctorId);
      notify(doctorUser?.id,'تذكير جلسة بعد 30 دقيقة','لديك جلسة قريبة اليوم '+a.date+' الساعة '+a.time,a.id);
      notify(a.patientUserId,'تذكير بموعدك بعد 30 دقيقة','موعدك مع '+doctorNameFor(a.doctorId)+' اليوم '+a.date+' الساعة '+a.time,a.id);
      for (const staffUser of db.users.filter(u=>u.role==='staff'&&u.status==='approved')) notify(staffUser.id,'تذكير جلسة قريبة','تبدأ الجلسة '+a.id+' خلال 30 دقيقة.',a.id);
      a.reminderSentAt = new Date().toISOString(); persist();
    }
  }
}
setInterval(sendSessionReminders, 60_000);
app.listen(PORT, HOST, () => console.log(`Ewan Hospital local demo running at http://localhost:${PORT}`));
