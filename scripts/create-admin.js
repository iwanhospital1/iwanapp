const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const empty = { doctors: [], appointments: [], pharmacy: [], videoSessions: [], payments: [], users: [], clinicalRecords: [], documents: [], notifications: [], audit: [], passwordOverrides: [] };
async function main() {
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let db = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : structuredClone(empty);
    for (const [key, value] of Object.entries(empty)) if (!Array.isArray(db[key])) db[key] = value;
    if (db.users.some(u => u.role === 'admin')) throw new Error('يوجد حساب أدمن بالفعل. استخدمه لتسجيل الدخول أو غيّر كلمة مروره من لوحة الإدارة.');
    const name = (await rl.question('Admin full name: ')).trim();
    const username = (await rl.question('Admin username (4+ English characters): ')).trim().toLowerCase();
    if (name.length < 2 || username.length < 4 || !/^[a-z0-9._-]+$/.test(username)) throw new Error('الاسم أو اسم المستخدم غير صالح. استخدم 4 أحرف إنجليزية على الأقل لاسم المستخدم.');
    if (db.users.some(u => String(u.username).toLowerCase() === username)) throw new Error('اسم المستخدم مستخدم بالفعل.');
    const password = await rl.question('Admin password (10+ characters): ');
    const confirm = await rl.question('Confirm password: ');
    if (password.length < 10 || password !== confirm) throw new Error('كلمتا المرور غير متطابقتين أو كلمة المرور أقل من 10 أحرف.');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    db.users.push({ id: crypto.randomUUID(), username, name, role: 'admin', status: 'approved', permissions: ['home','appointments','doctors','accounts','finance','medical','pharmacy','video','audit','notifications','schedule','mySessions','backup'], salt, passwordHash, createdAt: new Date().toISOString() });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, DATA_FILE);
    console.log('\nSUCCESS: Admin account created and saved to ' + DATA_FILE);
    console.log('Use the username you entered and the password you chose to sign in.');
  } finally {
    rl.close();
  }
}
main().catch(e => { console.error('\nAdmin setup failed: ' + e.message); process.exitCode = 1; });
