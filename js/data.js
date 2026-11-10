/* ========================================
   DATA LAYER - Categories, Api + Store (Google Sheets sync), Capture, Calculations
   ======================================== */

const EXPENSE_CATEGORIES = [
    { id: 'food', name: 'Food & Dining', icon: 'fas fa-utensils' },
    { id: 'groceries', name: 'Groceries', icon: 'fas fa-basket-shopping' },
    { id: 'transport', name: 'Transport', icon: 'fas fa-car' },
    { id: 'rent', name: 'Rent & Utilities', icon: 'fas fa-home' },
    { id: 'bills', name: 'Bills & Recharge', icon: 'fas fa-file-invoice' },
    { id: 'subscriptions', name: 'Subscriptions', icon: 'fas fa-tv' },
    { id: 'investments', name: 'Investments / SIP', icon: 'fas fa-chart-line', isSavings: true },
    { id: 'emi', name: 'EMI / Loans', icon: 'fas fa-credit-card' },
    { id: 'shopping', name: 'Shopping', icon: 'fas fa-shopping-bag' },
    { id: 'health', name: 'Health', icon: 'fas fa-heartbeat' },
    { id: 'entertainment', name: 'Entertainment', icon: 'fas fa-gamepad' },
    { id: 'travel', name: 'Travel', icon: 'fas fa-plane' },
    { id: 'education', name: 'Education', icon: 'fas fa-book' },
    { id: 'family', name: 'Family & Personal', icon: 'fas fa-people-roof' },
    { id: 'gifts', name: 'Gifts & Donations', icon: 'fas fa-gift' },
    { id: 'misc', name: 'Miscellaneous', icon: 'fas fa-ellipsis-h' },
];

const INCOME_CATEGORIES = [
    { id: 'salary', name: 'Salary', icon: 'fas fa-briefcase' },
    { id: 'freelance', name: 'Freelance / Side Income', icon: 'fas fa-laptop' },
    { id: 'interest', name: 'Interest & Dividends', icon: 'fas fa-percent' },
    { id: 'refund', name: 'Refund / Cashback', icon: 'fas fa-rotate-left' },
    { id: 'gift_in', name: 'Gift Received', icon: 'fas fa-hand-holding-heart' },
    { id: 'other_income', name: 'Other Income', icon: 'fas fa-coins' },
];

const TRANSFER_CATEGORY = { id: 'transfer', name: 'Transfer', icon: 'fas fa-arrow-right-arrow-left' };

const ACCOUNT_TYPES = ['Savings', 'Salary', 'Current', 'Cash / Wallet', 'Credit Card', 'Other'];
const PAYMENT_MODES = ['UPI', 'Card', 'Cash', 'Net Banking', 'Auto-Debit'];
const ACCOUNT_COLORS = ['#2a78d6', '#1baf7a', '#eb6834', '#6250d6', '#e87ba4', '#eda100', '#008300', '#e34948'];

function getCategory(id) {
    return EXPENSE_CATEGORIES.find(c => c.id === id)
        || INCOME_CATEGORIES.find(c => c.id === id)
        || (id === 'transfer' ? TRANSFER_CATEGORY : { id, name: id || 'Other', icon: 'fas fa-tag' });
}

function emptyUserData(displayName) {
    return {
        version: 2,
        profile: { displayName, createdAt: new Date().toISOString() },
        settings: {
            defaultSavingsTarget: 0, investmentsCountAsSavings: true,
            lockOnOpen: true, dailyReminder: true, reminderTime: '21:00', dueReminders: true, budgetAlerts: true,
            autoSaveKnown: false, categoryRules: {}, budgetAlerted: {},
        },
        accounts: [],
        transactions: [],
        recurring: [],
        budgets: [],
        savingsTargets: {},   // { 'YYYY-MM': amount } overrides the default target
    };
}

/* --- Small helpers --- */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatCurrency(amount, opts = {}) {
    const num = Number(amount) || 0;
    const sign = num < 0 ? '-' : (opts.plus && num > 0 ? '+' : '');
    return sign + '₹' + Math.abs(num).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatCompact(amount) {
    const n = Math.abs(Number(amount) || 0);
    const sign = amount < 0 ? '-' : '';
    if (n >= 1e7) return `${sign}₹${(n / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
    if (n >= 1e5) return `${sign}₹${(n / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
    if (n >= 1e3) return `${sign}₹${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `${sign}₹${Math.round(n)}`;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Today", "Yesterday", or a short date for lists. */
function friendlyDate(dateStr) {
    const t = todayStr();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    if (dateStr === t) return 'Today';
    if (dateStr === yStr) return 'Yesterday';
    const sameYear = dateStr.slice(0, 4) === t.slice(0, 4);
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }

function currentMonthKey() { return todayStr().slice(0, 7); }

function shiftMonth(monthKey, delta) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthKey, short = false) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    if (short) return `${d.toLocaleDateString('en-IN', { month: 'short' })} '${String(y).slice(2)}`;
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function lastDayOfMonth(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ========================================
   API - talks to the Google Apps Script web app that stores data in Google Sheets
   ======================================== */
const Api = {
    URL_KEY: 'mb_api_url',

    // A link saved on this device wins; otherwise use the one built into the app
    get url() { return localStorage.getItem(this.URL_KEY) || APP_CONFIG.apiUrl || ''; },
    set url(v) { localStorage.setItem(this.URL_KEY, v.trim()); },
    get isCustom() { return !!localStorage.getItem(this.URL_KEY) && localStorage.getItem(this.URL_KEY) !== APP_CONFIG.apiUrl; },

    isValidUrl(v) {
        return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(String(v).trim());
    },

    async call(action, payload = {}) {
        if (!this.url) throw new Error('Connect your Google Sheet first');
        let res;
        try {
            // text/plain avoids a CORS preflight, which Apps Script can't answer
            res = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...payload }), redirect: 'follow' });
        } catch {
            const err = new Error('No internet connection');
            err.offline = true;
            throw err;
        }
        let body;
        try { body = await res.json(); } catch { throw new Error('The Google Sheet link is not a MoneyBook web app'); }
        if (!body.ok) {
            const err = new Error(body.error || 'Server error');
            err.auth = /session expired/i.test(body.error || '');
            throw err;
        }
        return body;
    },
};

/* ========================================
   STORE - logged-in user, offline cache, and sync with the Sheet
   The app edits Store.data directly and calls Store.save(); save() works out
   what changed since the last sync and queues those rows for upload.
   ======================================== */
const TABLE_FIELDS = {
    Accounts: ['id', 'name', 'bank', 'type', 'last4', 'openingBalance', 'openingDate', 'isMain', 'color', 'archived'],
    Transactions: ['id', 'date', 'type', 'amount', 'accountId', 'toAccountId', 'category', 'paymentMode', 'note', 'source'],
    Recurring: ['id', 'name', 'amount', 'category', 'accountId', 'frequency', 'debitDay', 'startMonth', 'lastPaidMonth', 'isActive', 'autoPost'],
    Budgets: ['id', 'month', 'category', 'amount'],
    Settings: ['id', 'key', 'value'],
};
const TABLE_KEYS = { Accounts: 'accounts', Transactions: 'transactions', Recurring: 'recurring', Budgets: 'budgets' };
const SETTINGS_KEYS = ['profile', 'settings', 'savingsTargets'];
const BOOL_FIELDS = ['isMain', 'archived', 'isActive', 'autoPost'];
const NUMBER_FIELDS = ['amount', 'openingBalance', 'debitDay'];

const Store = {
    SESSIONS_KEY: 'mb_sessions',
    CURRENT_KEY: 'mb_current',
    UNLOCKED_KEY: 'mb_unlocked',

    userId: null,
    token: null,
    data: null,
    syncState: 'idle',     // idle | syncing | offline | error
    onChange: null,        // set by the app: called after remote data arrives
    flushing: false,

    /* --- device sessions (several people can use one phone) --- */
    getSessions() {
        try { return JSON.parse(localStorage.getItem(this.SESSIONS_KEY)) || {}; } catch { return {}; }
    },
    setSessions(s) { localStorage.setItem(this.SESSIONS_KEY, JSON.stringify(s)); },
    cacheKey(u) { return `mb_cache_${u}`; },
    queueKey(u) { return `mb_queue_${u}`; },
    snapKey(u) { return `mb_snap_${u}`; },

    /* --- local password check, so the app can be unlocked offline --- */
    async verifier(password, salt) {
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150000, hash: 'SHA-256' }, material, 256);
        return btoa(String.fromCharCode(...new Uint8Array(bits)));
    },

    async register(userId, displayName, password) {
        const res = await Api.call('register', { userId, displayName, password });
        await this.startSession(res, password);
    },

    async login(userId, password) {
        const res = await Api.call('login', { userId, password });
        await this.startSession(res, password);
    },

    async startSession(res, password) {
        const salt = generateId() + generateId();
        const sessions = this.getSessions();
        sessions[res.userId] = { token: res.token, displayName: res.displayName, salt, verifier: await this.verifier(password, salt) };
        this.setSessions(sessions);
        this.userId = res.userId;
        this.token = res.token;
        localStorage.setItem(this.CURRENT_KEY, res.userId);
        sessionStorage.setItem(this.UNLOCKED_KEY, res.userId);
        localStorage.removeItem(this.queueKey(res.userId));
        this.applyServerData(res.data, res.displayName);
        await this.importPreviousVersion(res.userId, password);
    },

    /**
     * One-time move of data saved by the earlier on-device version (encrypted with the
     * same User ID + password) into the Sheet, if the Sheet has nothing for this user yet.
     */
    async importPreviousVersion(userId, password) {
        try {
            const old = (JSON.parse(localStorage.getItem('em_users')) || {})[userId];
            const blob = JSON.parse(localStorage.getItem(`em_data_${userId}`) || 'null');
            if (!old || !blob || this.data.accounts.length || this.data.transactions.length) return;
            const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
            const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
            const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(old.salt), iterations: old.iterations, hash: 'SHA-256' },
                material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct));
            const previous = this.normalize(JSON.parse(new TextDecoder().decode(plain)));
            Object.assign(this.data, previous, { settings: { ...this.data.settings, ...previous.settings } });
            localStorage.removeItem(`em_data_${userId}`);
            await this.save();
            this.importedPrevious = true;
        } catch { /* different password or no old data: nothing to import */ }
    },

    /** Unlock a user who already logged in on this device (works offline). */
    async unlock(userId, password) {
        const id = String(userId).trim().toLowerCase();
        const s = this.getSessions()[id];
        if (!s) return false;
        if (await this.verifier(password, s.salt) !== s.verifier) throw new Error('Incorrect User ID or password');
        this.openLocal(id);
        sessionStorage.setItem(this.UNLOCKED_KEY, id);
        return true;
    },

    /** Resume without a password (same browser tab, or "ask password on open" turned off). */
    resume() {
        const id = localStorage.getItem(this.CURRENT_KEY);
        const s = id && this.getSessions()[id];
        if (!s) return false;
        this.openLocal(id);
        const lockOnOpen = this.data.settings.lockOnOpen !== false;
        if (lockOnOpen && sessionStorage.getItem(this.UNLOCKED_KEY) !== id) {
            this.userId = null; this.data = null;
            return false;
        }
        return true;
    },

    openLocal(id) {
        const s = this.getSessions()[id];
        this.userId = id;
        this.token = s.token;
        localStorage.setItem(this.CURRENT_KEY, id);
        try { this.data = JSON.parse(localStorage.getItem(this.cacheKey(id))); } catch { this.data = null; }
        if (!this.data) this.data = emptyUserData(s.displayName);
        this.normalize(this.data);
    },

    lock() {
        sessionStorage.removeItem(this.UNLOCKED_KEY);
        this.userId = null; this.token = null; this.data = null;
    },

    /** Remove this user's session and cached data from this device. */
    forget(id = this.userId) {
        const sessions = this.getSessions();
        delete sessions[id];
        this.setSessions(sessions);
        [this.cacheKey(id), this.queueKey(id), this.snapKey(id)].forEach(k => localStorage.removeItem(k));
        if (localStorage.getItem(this.CURRENT_KEY) === id) localStorage.removeItem(this.CURRENT_KEY);
        this.lock();
    },

    async changePassword(oldPassword, newPassword) {
        const res = await Api.call('changePassword', { userId: this.userId, token: this.token, oldPassword, newPassword });
        const sessions = this.getSessions();
        const salt = generateId() + generateId();
        sessions[this.userId] = { ...sessions[this.userId], token: res.token, salt, verifier: await this.verifier(newPassword, salt) };
        this.setSessions(sessions);
        this.token = res.token;
    },

    /* --- converting between app data and Sheet rows --- */
    normalize(d) {
        const base = emptyUserData(d.profile?.displayName || '');
        d.profile = { ...base.profile, ...d.profile };
        d.settings = { ...base.settings, ...d.settings };
        d.savingsTargets = d.savingsTargets || {};
        ['accounts', 'transactions', 'recurring', 'budgets'].forEach(k => { d[k] = d[k] || []; });
        return d;
    },

    toTables(d) {
        const blank = f => (BOOL_FIELDS.includes(f) ? false : NUMBER_FIELDS.includes(f) ? 0 : '');
        const pick = (table, rec) => Object.fromEntries(TABLE_FIELDS[table].map(f => [f, rec[f] === undefined || rec[f] === null ? blank(f) : rec[f]]));
        const tables = {};
        Object.entries(TABLE_KEYS).forEach(([table, key]) => { tables[table] = d[key].map(r => pick(table, r)); });
        tables.Settings = SETTINGS_KEYS.map(key => ({ id: `${this.userId}:${key}`, key, value: JSON.stringify(d[key] || {}) }));
        return tables;
    },

    fromTables(tables, displayName) {
        const d = emptyUserData(displayName);
        Object.entries(TABLE_KEYS).forEach(([table, key]) => {
            d[key] = (tables[table] || []).map(r => Object.fromEntries(TABLE_FIELDS[table].map(f => [f, r[f]])));
        });
        (tables.Settings || []).forEach(s => {
            if (!SETTINGS_KEYS.includes(s.key)) return;
            try { d[s.key] = { ...d[s.key], ...JSON.parse(s.value) }; } catch { /* ignore bad cell */ }
        });
        d.accounts.forEach(a => { a.last4 = String(a.last4 || ''); });
        return this.normalize(d);
    },

    snapshotOf(d) {
        const snap = {};
        Object.entries(this.toTables(d)).forEach(([table, rows]) => {
            snap[table] = Object.fromEntries(rows.map(r => [r.id, JSON.stringify(r)]));
        });
        return snap;
    },

    applyServerData(tables, displayName) {
        let d = this.fromTables(tables, displayName || this.getSessions()[this.userId]?.displayName);
        const queue = this.getQueue();
        if (queue.length) d = this.applyOps(d, queue);   // keep edits made while the request was in flight
        localStorage.setItem(this.snapKey(this.userId), JSON.stringify(this.snapshotOf(this.fromTables(tables, displayName))));
        // Update in place: open forms hold a reference to Store.data and must keep writing to the live object
        if (this.data) {
            Object.keys(this.data).forEach(k => { delete this.data[k]; });
            Object.assign(this.data, d);
        } else {
            this.data = d;
        }
        localStorage.setItem(this.cacheKey(this.userId), JSON.stringify(d));
    },

    applyOps(d, ops) {
        const tables = this.toTables(d);
        ops.forEach(o => {
            const rows = tables[o.table];
            const i = rows.findIndex(r => r.id === o.record.id);
            if (o.op === 'delete') { if (i >= 0) rows.splice(i, 1); } else if (i >= 0) rows[i] = o.record; else rows.push(o.record);
        });
        return this.fromTables(tables, d.profile.displayName);
    },

    getQueue() {
        try { return JSON.parse(localStorage.getItem(this.queueKey(this.userId))) || []; } catch { return []; }
    },
    setQueue(q) { localStorage.setItem(this.queueKey(this.userId), JSON.stringify(q)); },

    /** Save locally right away, queue the changed rows, and upload in the background. */
    async save() {
        if (!this.userId) return;
        let snap;
        try { snap = JSON.parse(localStorage.getItem(this.snapKey(this.userId))) || {}; } catch { snap = {}; }
        const current = this.snapshotOf(this.data);
        const queue = this.getQueue();
        const upsert = (table, id, op, record) => {
            const i = queue.findIndex(q => q.table === table && q.record.id === id);
            const entry = { table, op, record };
            if (i >= 0) queue[i] = entry; else queue.push(entry);
        };
        Object.keys(current).forEach(table => {
            const before = snap[table] || {};
            Object.entries(current[table]).forEach(([id, json]) => { if (before[id] !== json) upsert(table, id, 'upsert', JSON.parse(json)); });
            Object.keys(before).forEach(id => { if (!(id in current[table])) upsert(table, id, 'delete', { id }); });
        });
        // Drop queued ops that now match the last synced state
        const pending = queue.filter(q => {
            const cur = (current[q.table] || {})[q.record.id];
            const old = (snap[q.table] || {})[q.record.id];
            return q.op === 'delete' ? old !== undefined && cur === undefined : cur !== undefined && cur !== old;
        });
        this.setQueue(pending);
        localStorage.setItem(this.cacheKey(this.userId), JSON.stringify(this.data));
        this.flush();
    },

    pendingCount() { return this.userId ? this.getQueue().length : 0; },

    setState(state) {
        this.syncState = state;
        if (this.onStateChange) this.onStateChange(state);
    },

    /** Upload queued changes, then download the latest from the Sheet. */
    async flush() {
        if (!this.userId || this.flushing) return;
        this.flushing = true;
        this.setState('syncing');
        const user = this.userId;
        try {
            const queue = this.getQueue();
            const res = queue.length
                ? await Api.call('push', { userId: user, token: this.token, ops: queue })
                : await Api.call('pull', { userId: user, token: this.token });
            if (this.userId !== user) return;
            // Remove the ops we just sent; anything added meanwhile stays queued
            const sent = new Set(queue.map(q => `${q.table}:${q.record.id}:${JSON.stringify(q.record)}:${q.op}`));
            this.setQueue(this.getQueue().filter(q => !sent.has(`${q.table}:${q.record.id}:${JSON.stringify(q.record)}:${q.op}`)));
            const before = JSON.stringify(this.data);
            this.applyServerData(res.data);
            this.setState('idle');
            if (before !== JSON.stringify(this.data) && this.onChange) this.onChange();
        } catch (err) {
            this.setState(err.offline ? 'offline' : 'error');
            if (err.auth && this.onAuthError) this.onAuthError();
        } finally {
            this.flushing = false;
            if (this.userId === user && this.getQueue().length && this.syncState === 'idle') setTimeout(() => this.flush(), 300);
        }
    },
};

/* ========================================
   CAPTURE - turns a bank SMS the user shared into a transaction draft
   (The Android side has already refused OTPs and anything that isn't a debit/credit.)
   ======================================== */
const MERCHANT_HINTS = [
    [/swiggy|zomato|domino|mcdonald|kfc|pizza|cafe|restaurant|starbucks|eatsure/i, 'food'],
    [/blinkit|zepto|bigbasket|instamart|dmart|jiomart|grocer|more retail|reliance fresh/i, 'groceries'],
    [/uber|ola|rapido|irctc|metro|fastag|petrol|fuel|hpcl|bpcl|indian oil|redbus/i, 'transport'],
    [/amazon|flipkart|myntra|ajio|meesho|nykaa|tata cliq|croma/i, 'shopping'],
    [/netflix|hotstar|spotify|prime video|youtube|sonyliv|zee5|apple\.com|google play/i, 'subscriptions'],
    [/airtel|jio|vodafone|\bvi\b|bsnl|electricity|bescom|mseb|tata power|adani|gas|broadband|recharge|bill/i, 'bills'],
    [/pharm|apollo|medplus|1mg|netmeds|hospital|clinic|diagnost/i, 'health'],
    [/zerodha|groww|upstox|mutual fund|\bsip\b|nps|kuvera|coin/i, 'investments'],
    [/emi|loan|bajaj fin/i, 'emi'],
    [/bookmyshow|pvr|inox|steam|playstation/i, 'entertainment'],
    [/makemytrip|goibibo|indigo|air india|vistara|oyo|airbnb|cleartrip/i, 'travel'],
];

const Capture = {
    merchantKey(m) {
        return String(m || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
    },

    matchAccount(data, last4) {
        if (!last4) return null;
        return data.accounts.find(a => !a.archived && String(a.last4 || '').split(/[\s,]+/).filter(Boolean).some(d => d.slice(-4) === last4 || last4.endsWith(d)));
    },

    guessCategory(data, merchant, type) {
        const rules = data.settings.categoryRules || {};
        const key = this.merchantKey(merchant);
        if (key && rules[key]) return { category: rules[key], learned: true };
        if (type === 'Income') return { category: /salary|sal\b/i.test(merchant || '') ? 'salary' : /refund|cashback|reversal/i.test(merchant || '') ? 'refund' : 'other_income', learned: false };
        const hint = MERCHANT_HINTS.find(([re]) => re.test(merchant || ''));
        return { category: hint ? hint[1] : null, learned: false };
    },

    /** Build a transaction draft from a native capture { id, amount, type, last4, merchant, mode, source, ts } */
    toDraft(data, cap) {
        const acc = this.matchAccount(data, cap.last4);
        const guess = this.guessCategory(data, cap.merchant, cap.type);
        const d = new Date(Number(cap.ts) || Date.now());
        return {
            captureId: cap.id,
            type: cap.type === 'credit' ? 'Income' : 'Expense',
            amount: Number(cap.amount),
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            accountId: acc?.id || null,
            category: guess.category,
            learned: guess.learned,
            paymentMode: cap.mode || 'UPI',
            note: cap.merchant || '',
            last4: cap.last4 || '',
            source: cap.source || 'share',
        };
    },

    /** Date written in the SMS (08-11-26, 08/11/2026, 08Nov26, 08-Nov-26…) as a timestamp, or null. */
    smsDate(text) {
        const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        let m = /\b(\d{1,2})[-/ ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ,]*(\d{2,4})\b/i.exec(text);
        let d, mo, y;
        if (m) { d = +m[1]; mo = months[m[2].toLowerCase()]; y = +m[3]; }
        else if ((m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(text))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
        else return null;
        if (y < 100) y += 2000;
        const date = new Date(y, mo - 1, d, 12);
        const ageDays = (Date.now() - date.getTime()) / 864e5;
        // Ignore impossible dates, future dates and anything older than ~3 months
        if (isNaN(date) || date.getDate() !== d || ageDays < -1 || ageDays > 92) return null;
        return date.getTime();
    },

    /** Parse pasted SMS text. Returns { draft } or { reason: 'sensitive' | 'none' }. */
    fromText(data, text) {
        if (TxnParser.isSensitive(text)) return { reason: 'sensitive' };
        const t = TxnParser.parse(text);
        if (!t) return { reason: 'none' };
        return { draft: this.toDraft(data, { ...t, id: `paste-${generateId()}`, source: 'paste', ts: this.smsDate(text) || Date.now() }) };
    },

    learn(data, merchant, category) {
        const key = this.merchantKey(merchant);
        if (!key || !category) return;
        data.settings.categoryRules = { ...(data.settings.categoryRules || {}), [key]: category };
    },
};

/* ========================================
   CALCULATIONS - balances, monthly stats, savings & carry forward
   ======================================== */
const Calc = {
    /** Balance of one account at the END of `upToDate` (inclusive). No date = all time. */
    accountBalance(data, account, upToDate = null) {
        let bal = 0;
        if (!upToDate || account.openingDate <= upToDate) bal += Number(account.openingBalance) || 0;
        for (const t of data.transactions) {
            if (upToDate && t.date > upToDate) continue;
            const amt = Number(t.amount) || 0;
            if (t.type === 'Transfer') {
                if (t.accountId === account.id) bal -= amt;
                if (t.toAccountId === account.id) bal += amt;
            } else if (t.accountId === account.id) {
                bal += t.type === 'Income' ? amt : -amt;
            }
        }
        return bal;
    },

    totalBalance(data, upToDate = null) {
        return data.accounts.reduce((sum, a) => sum + this.accountBalance(data, a, upToDate), 0);
    },

    mainAccount(data) {
        return data.accounts.find(a => a.isMain && !a.archived) || data.accounts.find(a => !a.archived) || null;
    },

    balanceSplit(data) {
        const main = this.mainAccount(data);
        const mainBal = main ? this.accountBalance(data, main) : 0;
        const total = this.totalBalance(data);
        return { main, mainBal, othersBal: total - mainBal, total };
    },

    monthTxns(data, monthKey) {
        return data.transactions.filter(t => t.date.startsWith(monthKey));
    },

    isSavingsCategory(data, categoryId) {
        return data.settings.investmentsCountAsSavings && !!EXPENSE_CATEGORIES.find(c => c.id === categoryId && c.isSavings);
    },

    targetFor(data, monthKey) {
        const override = data.savingsTargets[monthKey];
        return override !== undefined && override !== null ? Number(override) : Number(data.settings.defaultSavingsTarget) || 0;
    },

    /** Full picture of a month: what came in, went out, was saved, and what carries forward. */
    monthStats(data, monthKey) {
        const txns = this.monthTxns(data, monthKey);
        let income = 0, spent = 0, invested = 0, transfers = 0;
        for (const t of txns) {
            const amt = Number(t.amount) || 0;
            if (t.type === 'Income') income += amt;
            else if (t.type === 'Transfer') transfers += amt;
            else if (this.isSavingsCategory(data, t.category)) invested += amt;
            else spent += amt;
        }
        const saved = income - spent;               // investments count as saved money
        const target = this.targetFor(data, monthKey);
        const openingBalance = this.totalBalance(data, `${shiftMonth(monthKey, -1)}-31`);  // carried in from last month
        const closingBalance = this.totalBalance(data, lastDayOfMonth(monthKey));            // carried forward to next month
        return {
            monthKey, income, spent, invested, transfers, saved, target,
            vsTarget: saved - target,
            targetPct: target > 0 ? Math.round((saved / target) * 100) : null,
            savingsRate: income > 0 ? Math.round((saved / income) * 100) : null,
            openingBalance, closingBalance,
            txnCount: txns.length,
        };
    },

    firstMonth(data) {
        // Tracking starts with the first transaction; opening-balance dates alone don't count
        const dates = data.transactions.map(t => t.date).filter(Boolean).sort();
        return dates.length ? monthKeyOf(dates[0]) : currentMonthKey();
    },

    /** Month-on-month history ending at `endMonth`, with a running "ahead/behind target" total. */
    savingsHistory(data, endMonth, count = 12) {
        const start = this.firstMonth(data);
        const rows = [];
        for (let i = count - 1; i >= 0; i--) {
            const m = shiftMonth(endMonth, -i);
            if (m < start) continue;
            rows.push(this.monthStats(data, m));
        }
        let running = 0;
        rows.forEach(r => { running += r.vsTarget; r.cumulativeVsTarget = running; });
        return rows;
    },

    categorySpend(data, monthKey) {
        const map = {};
        for (const t of this.monthTxns(data, monthKey)) {
            if (t.type !== 'Expense') continue;
            map[t.category] = (map[t.category] || 0) + Number(t.amount);
        }
        return Object.entries(map).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
    },
};
