// Local preview: try changes on your computer (or phone, same Wi-Fi) before pushing.
//
//   npm run preview            → http://localhost:8080
//   npm run preview -- 9000    → another port
//   npm run preview -- --reset → start again with an empty test Sheet
//
// The app talks to a fake Google Sheet that runs apps-script/Code.gs right here.
// Your real Sheet is never used, so nothing you do in the preview changes your real data.
// Test data is kept in .preview/sheet.json between runs (ignored by git).
// To try it with your own numbers: in the real app use More → Export (JSON),
// then in the preview sign up and use More → Import.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGas } = require('./dev/sheet-emulator');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.preview');
const DATA_FILE = path.join(DATA_DIR, 'sheet.json');
const args = process.argv.slice(2);
const PORT = Number(args.find(a => /^\d+$/.test(a))) || 8080;
const API_PATH = '/preview-api';

const gas = createGas(path.join(ROOT, 'apps-script', 'Code.gs'));

/* ---------- keep the fake Sheet between runs ---------- */
const reviveRow = row => row.map(v => (v && typeof v === 'object' && v.$date ? new Date(v.$date) : v));
if (args.includes('--reset')) fs.rmSync(DATA_FILE, { force: true });
gas.run('setup');   // creates the tabs and header rows, like the real Sheet
if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const [name, rows] of Object.entries(saved)) {
        const sh = gas.sheets[name];
        if (sh) sh.rows.splice(0, sh.rows.length, ...rows.map(reviveRow));
    }
    gas.run('setup');   // adds any header columns that are new since the data was saved
}
const save = () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = {};
    for (const [name, sh] of Object.entries(gas.sheets)) {
        out[name] = sh.rows.map(r => r.map(v => (v instanceof Date ? { $date: v.toISOString() } : v)));
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(out));
};

/* ---------- static files ---------- */
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const ALLOWED = ['index.html', 'manifest.json', 'css/', 'js/', 'icons/', 'fonts/'];

// The preview must always show the files as they are now, so no offline cache:
// this replacement service worker removes the real one and its cache.
const SW_RESET = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.map(n => caches.delete(n))))
  .then(() => self.registration.unregister()).then(() => self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate(c.url)))));`;

const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(body);
    };

    if (url === API_PATH && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            try {
                const result = gas.call(body);
                save();
                send(200, JSON.stringify(result), 'application/json');
            } catch (e) {
                console.error('Sheet error:', e.message);
                send(200, JSON.stringify({ ok: false, error: 'Preview Sheet error: ' + e.message }), 'application/json');
            }
        });
        return;
    }
    if (url === '/sw.js') return send(200, SW_RESET, TYPES['.js']);
    if (url === '/js/config.js') {
        // Point the app at the fake Sheet instead of the real one
        const cfg = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace(/apiUrl:\s*'[^']*'/, `apiUrl: '${API_PATH}'`);
        return send(200, cfg, TYPES['.js']);
    }

    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    if (!ALLOWED.some(a => rel === a || (a.endsWith('/') && rel.startsWith(a))) || rel.includes('..')) return send(404, 'Not found');
    fs.readFile(path.join(ROOT, rel), (err, data) => {
        if (err) return send(404, 'Not found');
        send(200, data, TYPES[path.extname(rel)] || 'application/octet-stream');
    });
});

server.listen(PORT, () => {
    const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
    console.log('\nMoneyBook preview (test data only, your real Sheet is not used)\n');
    console.log(`  On this computer:  http://localhost:${PORT}`);
    if (lan) console.log(`  On your phone:     http://${lan.address}:${PORT}   (same Wi-Fi)`);
    console.log(`\n  Test data: ${path.relative(ROOT, DATA_FILE)}   ·   Start fresh: npm run preview -- --reset`);
    console.log('  Edit files, then refresh the page to see the change. Ctrl+C to stop.\n');
});
