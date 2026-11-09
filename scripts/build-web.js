// Copies the web app into www/ for the Android build (Capacitor's webDir).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const include = ['index.html', 'manifest.json', 'css', 'js', 'icons'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of include) {
    fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}
console.log(`Copied ${include.join(', ')} → www/`);
