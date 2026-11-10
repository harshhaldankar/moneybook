/* ========================================
   MONEYBOOK - Google Sheets backend (Apps Script web app)

   Deploy: Extensions → Apps Script → paste this file → Deploy → New deployment
           → Web app, Execute as: Me, Who has access: Anyone.
   Then run `setup` once from the editor to create the tabs and the daily trigger.
   ======================================== */

const SCHEMA = {
    Users: ['userId', 'displayName', 'email', 'salt', 'passHash', 'token', 'createdAt'],
    Accounts: ['id', 'userId', 'name', 'bank', 'type', 'last4', 'openingBalance', 'openingDate', 'isMain', 'color', 'archived', 'updatedAt'],
    Transactions: ['id', 'userId', 'date', 'type', 'amount', 'accountId', 'accountName', 'toAccountId', 'toAccountName', 'category', 'paymentMode', 'note', 'source', 'updatedAt', 'refNo', 'time'],
    Recurring: ['id', 'userId', 'name', 'amount', 'category', 'accountId', 'frequency', 'debitDay', 'startMonth', 'lastPaidMonth', 'isActive', 'autoPost', 'updatedAt'],
    Budgets: ['id', 'userId', 'month', 'category', 'amount', 'updatedAt'],
    Settings: ['id', 'userId', 'key', 'value', 'updatedAt'],
};

// Tables the app can read and write (Users is server-only)
const DATA_TABLES = ['Accounts', 'Transactions', 'Recurring', 'Budgets', 'Settings'];
const NUMBER_FIELDS = ['amount', 'openingBalance', 'debitDay'];
const BOOL_FIELDS = ['isMain', 'archived', 'isActive', 'autoPost'];
const HASH_ROUNDS = 2000;
// Max number of people who can create a login. Change it in
// Project Settings → Script properties → MAX_USERS.
const DEFAULT_MAX_USERS = 10;

/* ---------- HTTP entry points ---------- */
function doGet() {
    return json({ ok: true, app: 'MoneyBook', version: 1 });
}

function doPost(e) {
    try {
        const req = JSON.parse(e.postData.contents);
        const handlers = { ping, register, login, pull, push, changePassword };
        if (!handlers[req.action]) throw new Error('Unknown action');
        return json({ ok: true, ...handlers[req.action](req) });
    } catch (err) {
        return json({ ok: false, error: err.message });
    }
}

function json(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Sheet helpers ---------- */
function sheet(name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(name);
    if (!sh) {
        sh = ss.insertSheet(name);
        sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
        sh.setFrozenRows(1);
    } else if (sh.getLastColumn() < SCHEMA[name].length) {
        // New columns are always added at the end, so older sheets just get the extra headers
        sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    }
    return sh;
}

function readAll(name) {
    const sh = sheet(name);
    const values = sh.getDataRange().getValues();
    const headers = values.shift() || SCHEMA[name];
    return values.map((row, i) => {
        const obj = { _row: i + 2 };
        headers.forEach((h, j) => { obj[h] = fromCell(h, row[j]); });
        return obj;
    });
}

function fromCell(field, v) {
    if (v instanceof Date) {
        // Date-looking cells (e.g. 2026-11-01) come back as Date objects; keep them as text
        const tz = Session.getScriptTimeZone();
        return field === 'startMonth' || field === 'month' || field === 'lastPaidMonth'
            ? Utilities.formatDate(v, tz, 'yyyy-MM') : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    }
    if (BOOL_FIELDS.indexOf(field) >= 0) return v === true || v === 'TRUE' || v === 'true';
    if (NUMBER_FIELDS.indexOf(field) >= 0) return v === '' ? 0 : Number(v);
    return v === null || v === undefined ? '' : String(v);
}

function toRow(name, obj) {
    return SCHEMA[name].map(h => {
        const v = obj[h];
        if (v === undefined || v === null) return '';
        // Prefix with ' so Sheets keeps dates/digits as text (e.g. last4 "0123")
        // and never runs text from SMS as a formula (=, +, -, @)
        if (typeof v === 'string' && (/^[\d\s,.:-]+$/.test(v) || /^[=+\-@]/.test(v))) return "'" + v;
        return v;
    });
}

function strip(obj) {
    const out = {};
    Object.keys(obj).forEach(k => { if (k !== '_row' && k !== 'userId') out[k] = obj[k]; });
    return out;
}

/* ---------- Auth ---------- */
function hashPassword(password, salt) {
    let digest = salt + ':' + password;
    for (let i = 0; i < HASH_ROUNDS; i++) {
        digest = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest, Utilities.Charset.UTF_8));
    }
    return digest;
}

function normalizeId(id) {
    return String(id || '').trim().toLowerCase();
}

function findUser(userId) {
    return readAll('Users').find(u => u.userId === normalizeId(userId));
}

function authed(req) {
    const user = findUser(req.userId);
    if (!user || !req.token || user.token !== req.token) throw new Error('Session expired. Please log in again.');
    return user;
}

function ping() {
    return { app: 'MoneyBook', version: 1 };
}

function register(req) {
    const userId = normalizeId(req.userId);
    if (!/^[a-z0-9._-]{3,24}$/.test(userId)) throw new Error('User ID must be 3-24 characters: letters, numbers, . _ -');
    if (String(req.password || '').length < 6) throw new Error('Password must be at least 6 characters');
    return withLock(() => {
        if (findUser(userId)) throw new Error('This User ID is already taken');
        const max = Number(PropertiesService.getScriptProperties().getProperty('MAX_USERS')) || DEFAULT_MAX_USERS;
        if (readAll('Users').length >= max) throw new Error('New sign-ups are closed. Ask the owner to raise MAX_USERS.');
        const salt = Utilities.getUuid();
        const token = Utilities.getUuid();
        sheet('Users').appendRow(toRow('Users', {
            userId, displayName: String(req.displayName || userId).slice(0, 40), email: '',
            salt, passHash: hashPassword(req.password, salt), token, createdAt: new Date().toISOString(),
        }));
        return { userId, token, displayName: req.displayName || userId, data: userData(userId) };
    });
}

function login(req) {
    const user = findUser(req.userId);
    if (!user || hashPassword(String(req.password || ''), user.salt) !== user.passHash) throw new Error('Incorrect User ID or password');
    // Keep the existing token so other devices stay logged in
    let token = user.token;
    if (!token) {
        token = Utilities.getUuid();
        sheet('Users').getRange(user._row, SCHEMA.Users.indexOf('token') + 1).setValue(token);
    }
    return { userId: user.userId, token, displayName: user.displayName, data: userData(user.userId) };
}

function changePassword(req) {
    const user = authed(req);
    if (hashPassword(String(req.oldPassword || ''), user.salt) !== user.passHash) throw new Error('Current password is incorrect');
    if (String(req.newPassword || '').length < 6) throw new Error('New password must be at least 6 characters');
    const salt = Utilities.getUuid();
    const token = Utilities.getUuid();   // logs out other devices
    const sh = sheet('Users');
    sh.getRange(user._row, SCHEMA.Users.indexOf('salt') + 1).setValue(salt);
    sh.getRange(user._row, SCHEMA.Users.indexOf('passHash') + 1).setValue(hashPassword(req.newPassword, salt));
    sh.getRange(user._row, SCHEMA.Users.indexOf('token') + 1).setValue(token);
    return { token };
}

/* ---------- Data sync ---------- */
function userData(userId) {
    const data = {};
    DATA_TABLES.forEach(t => { data[t] = readAll(t).filter(r => r.userId === userId).map(strip); });
    return data;
}

function pull(req) {
    const user = authed(req);
    return { data: userData(user.userId), serverTime: new Date().toISOString() };
}

/** Apply a batch of ops: [{ table, op: 'upsert'|'delete', record }] */
function push(req) {
    const user = authed(req);
    const ops = Array.isArray(req.ops) ? req.ops : [];
    withLock(() => {
        const accountNames = {};
        readAll('Accounts').filter(a => a.userId === user.userId).forEach(a => { accountNames[a.id] = a.name; });
        ops.filter(o => o.table === 'Accounts' && o.op === 'upsert').forEach(o => { accountNames[o.record.id] = o.record.name; });

        DATA_TABLES.forEach(table => {
            const tableOps = ops.filter(o => o.table === table && o.record && o.record.id);
            if (!tableOps.length) return;
            const sh = sheet(table);
            const rows = readAll(table);
            const toDelete = [];
            tableOps.forEach(o => {
                const existing = rows.find(r => r.id === o.record.id);
                if (existing && existing.userId !== user.userId) return;   // never touch another user's row
                if (o.op === 'delete') {
                    if (existing) toDelete.push(existing._row);
                    return;
                }
                const record = Object.assign({}, o.record, { userId: user.userId, updatedAt: new Date().toISOString() });
                if (table === 'Transactions') {
                    record.accountName = accountNames[record.accountId] || '';
                    record.toAccountName = record.toAccountId ? (accountNames[record.toAccountId] || '') : '';
                }
                const row = toRow(table, record);
                if (existing) sh.getRange(existing._row, 1, 1, row.length).setValues([row]);
                else { sh.appendRow(row); rows.push(Object.assign({ _row: sh.getLastRow() }, record)); }
            });
            // Delete bottom-up so row numbers stay valid
            toDelete.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
        });
    });
    return { applied: ops.length, data: userData(user.userId) };
}

function withLock(fn) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- Daily job: record auto-debits (SIP, EMI, rent…) on their debit day ---------- */
function shiftMonth(monthKey, delta) {
    const parts = monthKey.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function monthDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return (pb[0] - pa[0]) * 12 + (pb[1] - pa[1]);
}

function nextDue(r, todayMonth) {
    const step = r.frequency === 'Quarterly' ? 3 : r.frequency === 'Yearly' ? 12 : 1;
    const start = r.startMonth || todayMonth;
    let m = r.lastPaidMonth ? shiftMonth(r.lastPaidMonth, step) : start;
    while (monthDiff(start, m) % step !== 0) m = shiftMonth(m, 1);
    const parts = m.split('-').map(Number);
    const lastDay = new Date(parts[0], parts[1], 0).getDate();
    return { month: m, date: m + '-' + ('0' + Math.min(Number(r.debitDay) || 1, lastDay)).slice(-2) };
}

function dailyJob() {
    const tz = Session.getScriptTimeZone();
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    withLock(() => {
        const recSheet = sheet('Recurring');
        const txSheet = sheet('Transactions');
        const accounts = readAll('Accounts');
        readAll('Recurring').filter(r => r.isActive && r.autoPost).forEach(r => {
            let due = nextDue(r, today.slice(0, 7));
            let guard = 0;
            while (due.date <= today && guard++ < 24) {
                const acc = accounts.find(a => a.id === r.accountId);
                txSheet.appendRow(toRow('Transactions', {
                    id: 'auto-' + r.id + '-' + due.month, userId: r.userId, date: due.date, type: 'Expense', amount: r.amount,
                    accountId: r.accountId, accountName: acc ? acc.name : '', toAccountId: '', toAccountName: '',
                    category: r.category, paymentMode: 'Auto-Debit', note: r.name, source: 'auto', updatedAt: new Date().toISOString(),
                }));
                r.lastPaidMonth = due.month;
                due = nextDue(r, today.slice(0, 7));
            }
            recSheet.getRange(r._row, SCHEMA.Recurring.indexOf('lastPaidMonth') + 1).setValue("'" + (r.lastPaidMonth || ''));
        });
    });
}

/* ---------- One-time setup (run from the editor) ---------- */
function setup() {
    Object.keys(SCHEMA).forEach(sheet);
    const first = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
    if (first && first.getLastRow() === 0 && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) {
        SpreadsheetApp.getActiveSpreadsheet().deleteSheet(first);
    }
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyJob').forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(6).create();
    dailyJob();
}
