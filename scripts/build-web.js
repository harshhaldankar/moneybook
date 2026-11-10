// Copies the web app into www/ (used for the Android build and the website deploy).
// If APPS_SCRIPT_URL is set (a GitHub secret in CI), it is written into www/js/config.js
// so users skip the "Connect your Google Sheet" step. The link is never committed.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const include = ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'icons'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of include) {
    fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}
console.log(`Copied ${include.join(', ')} → www/`);

const apiUrl = (process.env.APPS_SCRIPT_URL || '').trim();
if (apiUrl) {
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(apiUrl)) {
        console.error('APPS_SCRIPT_URL must be an Apps Script web app link ending in /exec');
        process.exit(1);
    }
    const configPath = path.join(out, 'js', 'config.js');
    const config = fs.readFileSync(configPath, 'utf8');
    const updated = config.replace(/apiUrl:\s*'[^']*'/, `apiUrl: ${JSON.stringify(apiUrl)}`);
    if (updated === config) { console.error('Could not find apiUrl in js/config.js'); process.exit(1); }
    fs.writeFileSync(configPath, updated);
    console.log('Built-in Google Sheet link set from APPS_SCRIPT_URL');
} else {
    console.log('APPS_SCRIPT_URL not set: users will see the Connect step');
}
