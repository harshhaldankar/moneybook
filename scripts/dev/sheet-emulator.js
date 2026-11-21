// Minimal Google Apps Script emulator: runs apps-script/Code.gs locally against an in-memory "Sheet".
// Used by npm run preview and the end-to-end tests, so nothing touches a real Google Sheet.
// Mimics Sheets' type coercion: unprefixed numeric strings → numbers, date strings → Date; "'" prefix keeps text.
const vm = require('vm'), fs = require('fs'), crypto = require('crypto');

function coerce(v) {
    if (typeof v !== 'string') return v;
    if (v.startsWith("'")) return v.slice(1);
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d || 1); }
    if (v === 'TRUE' || v === 'FALSE') return v === 'TRUE';
    return v;
}

function makeSheet(name) {
    const rows = [];
    const sh = {
        name, rows,
        getRange(r, c, nr = 1, nc = 1) {
            return {
                setValues(vals) { vals.forEach((row, i) => { while (rows.length < r + i) rows.push([]); row.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = coerce(v); }); }); return this; },
                setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = coerce(v); return this; },
                setFontWeight() { return this; },
            };
        },
        getDataRange() { const w = Math.max(0, ...rows.map(r => r.length)); return { getValues: () => rows.map(r => Array.from({ length: w }, (_, i) => r[i] === undefined ? '' : r[i])) }; },
        appendRow(row) { rows.push(row.map(coerce)); },
        getLastRow() { return rows.length; },
        getLastColumn() { return Math.max(0, ...rows.map(r => r.length)); },
        deleteRow(r) { rows.splice(r - 1, 1); },
        setFrozenRows() {},
    };
    return sh;
}

function createGas(codePath) {
    const sheets = {};
    const ss = {
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = makeSheet(n)),
        getSheets: () => Object.values(sheets),
        deleteSheet: sh => { delete sheets[sh.name]; },
    };
    const pad = n => String(n).padStart(2, '0');
    const ctx = {
        SpreadsheetApp: { getActiveSpreadsheet: () => ss },
        Utilities: {
            DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
            computeDigest: (alg, str) => Array.from(crypto.createHash(alg).update(str, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
            base64Encode: bytes => Buffer.from(bytes.map(b => (b + 256) % 256)).toString('base64'),
            getUuid: () => crypto.randomUUID(),
            formatDate: (d, tz, fmt) => fmt.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())),
        },
        Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
        PropertiesService: { getScriptProperties: () => ({ getProperty: k => (process.env['GAS_' + k] || null) }) },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
        ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
        console,
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx);
    return {
        sheets,
        call: body => JSON.parse(ctx.doPost({ postData: { contents: body } }).content),
        run: fn => vm.runInContext(`${fn}()`, ctx),
    };
}

module.exports = { createGas };
