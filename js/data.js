/* ========================================
   DATA LAYER - Categories, Vault (login + encrypted storage), Calculations
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
        settings: { defaultSavingsTarget: 0, investmentsCountAsSavings: true },
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
   VAULT - per-user login with encrypted data
   Each user's data is encrypted with AES-GCM using a key derived from their
   password (PBKDF2). Without the password the data cannot be read, so
   several people can share one device safely.
   ======================================== */
const Vault = {
    USERS_KEY: 'em_users',
    SESSION_KEY: 'em_session',
    PBKDF2_ITERATIONS: 250000,

    username: null,
    key: null,
    data: null,

    isSupported() {
        return !!(window.crypto && window.crypto.subtle);
    },

    getUsers() {
        try { return JSON.parse(localStorage.getItem(this.USERS_KEY)) || {}; } catch { return {}; }
    },

    setUsers(users) {
        localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
    },

    normalizeUsername(name) {
        return String(name || '').trim().toLowerCase();
    },

    /* --- crypto primitives --- */
    toB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); },
    fromB64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); },

    async deriveKey(password, saltB64, iterations) {
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: this.fromB64(saltB64), iterations, hash: 'SHA-256' },
            material,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    async encrypt(key, obj) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
        return { iv: this.toB64(iv), ct: this.toB64(ct) };
    },

    async decrypt(key, blob) {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.fromB64(blob.iv) }, key, this.fromB64(blob.ct));
        return JSON.parse(new TextDecoder().decode(pt));
    },

    dataKey(username) { return `em_data_${username}`; },

    /* --- account lifecycle --- */
    async signUp(rawUsername, displayName, password, initialData = null) {
        const username = this.normalizeUsername(rawUsername);
        if (!/^[a-z0-9._-]{3,24}$/.test(username)) throw new Error('User ID must be 3-24 characters: letters, numbers, . _ -');
        if (password.length < 6) throw new Error('Password must be at least 6 characters');
        const users = this.getUsers();
        if (users[username]) throw new Error('This User ID is already taken on this device');

        const salt = this.toB64(crypto.getRandomValues(new Uint8Array(16)));
        const key = await this.deriveKey(password, salt, this.PBKDF2_ITERATIONS);
        const data = initialData || emptyUserData(displayName || rawUsername);
        data.profile.displayName = displayName || data.profile.displayName || rawUsername;

        localStorage.setItem(this.dataKey(username), JSON.stringify(await this.encrypt(key, data)));
        users[username] = { displayName: data.profile.displayName, salt, iterations: this.PBKDF2_ITERATIONS, createdAt: new Date().toISOString() };
        this.setUsers(users);
        await this.openSession(username, key, data);
    },

    async signIn(rawUsername, password) {
        const username = this.normalizeUsername(rawUsername);
        const user = this.getUsers()[username];
        const blob = JSON.parse(localStorage.getItem(this.dataKey(username)) || 'null');
        if (!user || !blob) throw new Error('Incorrect User ID or password');
        const key = await this.deriveKey(password, user.salt, user.iterations);
        let data;
        try { data = await this.decrypt(key, blob); } catch { throw new Error('Incorrect User ID or password'); }
        await this.openSession(username, key, data);
    },

    async openSession(username, key, data) {
        this.username = username;
        this.key = key;
        this.data = data;
        const raw = await crypto.subtle.exportKey('raw', key);
        // sessionStorage is per-tab and cleared when the tab closes
        sessionStorage.setItem(this.SESSION_KEY, JSON.stringify({ username, k: this.toB64(raw) }));
    },

    async restoreSession() {
        try {
            const sess = JSON.parse(sessionStorage.getItem(this.SESSION_KEY) || 'null');
            if (!sess) return false;
            const key = await crypto.subtle.importKey('raw', this.fromB64(sess.k), 'AES-GCM', true, ['encrypt', 'decrypt']);
            const blob = JSON.parse(localStorage.getItem(this.dataKey(sess.username)) || 'null');
            if (!blob) return false;
            this.data = await this.decrypt(key, blob);
            this.username = sess.username;
            this.key = key;
            return true;
        } catch {
            sessionStorage.removeItem(this.SESSION_KEY);
            return false;
        }
    },

    signOut() {
        this.username = null;
        this.key = null;
        this.data = null;
        sessionStorage.removeItem(this.SESSION_KEY);
    },

    async save() {
        if (!this.key) return;
        localStorage.setItem(this.dataKey(this.username), JSON.stringify(await this.encrypt(this.key, this.data)));
        const users = this.getUsers();
        if (users[this.username]) {
            users[this.username].displayName = this.data.profile.displayName;
            this.setUsers(users);
        }
    },

    async changePassword(oldPassword, newPassword) {
        if (newPassword.length < 6) throw new Error('New password must be at least 6 characters');
        const users = this.getUsers();
        const user = users[this.username];
        const oldKey = await this.deriveKey(oldPassword, user.salt, user.iterations);
        try { await this.decrypt(oldKey, JSON.parse(localStorage.getItem(this.dataKey(this.username)))); }
        catch { throw new Error('Current password is incorrect'); }

        const salt = this.toB64(crypto.getRandomValues(new Uint8Array(16)));
        const key = await this.deriveKey(newPassword, salt, this.PBKDF2_ITERATIONS);
        localStorage.setItem(this.dataKey(this.username), JSON.stringify(await this.encrypt(key, this.data)));
        users[this.username] = { ...user, salt, iterations: this.PBKDF2_ITERATIONS };
        this.setUsers(users);
        await this.openSession(this.username, key, this.data);
    },

    async deleteCurrentUser(password) {
        const users = this.getUsers();
        const user = users[this.username];
        const key = await this.deriveKey(password, user.salt, user.iterations);
        try { await this.decrypt(key, JSON.parse(localStorage.getItem(this.dataKey(this.username)))); }
        catch { throw new Error('Password is incorrect'); }
        localStorage.removeItem(this.dataKey(this.username));
        delete users[this.username];
        this.setUsers(users);
        this.signOut();
    },
};

/* ========================================
   LEGACY MIGRATION - data from the old 2-account version (expenseApp_* keys)
   ======================================== */
const Legacy = {
    exists() {
        return localStorage.getItem('expenseApp_transactions') !== null || localStorage.getItem('expenseApp_settings') !== null;
    },

    read(key, fallback) {
        try { return JSON.parse(localStorage.getItem(`expenseApp_${key}`)) ?? fallback; } catch { return fallback; }
    },

    toUserData(displayName) {
        const data = emptyUserData(displayName);
        const s = this.read('settings', {});
        const legacyTxns = this.read('transactions', []);
        const today = legacyTxns.map(t => t.date).filter(Boolean).sort()[0] || todayStr();
        const acc1 = { id: generateId(), name: s.acc1Name || 'Account 1', bank: '', type: 'Savings', openingBalance: Number(s.acc1OpeningBalance) || 0, openingDate: today, isMain: false, color: ACCOUNT_COLORS[0], archived: false };
        const acc2 = { id: generateId(), name: s.acc2Name || 'Account 2', bank: '', type: 'Salary', openingBalance: Number(s.acc2OpeningBalance) || 0, openingDate: today, isMain: true, color: ACCOUNT_COLORS[1], archived: false };
        data.accounts = [acc2, acc1];
        const accId = name => (name === 'Account 1' ? acc1.id : acc2.id);

        const txns = legacyTxns;
        const seenLinks = new Set();
        txns.forEach(t => {
            if (t.type === 'Transfer') {
                if (t.linkedId && seenLinks.has(t.id)) return;
                const partner = txns.find(p => p.id === t.linkedId);
                if (partner) seenLinks.add(partner.id);
                const out = t.transferDirection === 'out' ? t : partner;
                const inn = t.transferDirection === 'in' ? t : partner;
                data.transactions.push({
                    id: generateId(), type: 'Transfer', amount: Number(t.amount), date: t.date,
                    accountId: out ? accId(out.account) : (accId(t.account) === acc1.id ? acc2.id : acc1.id),
                    toAccountId: inn ? accId(inn.account) : (accId(t.account) === acc1.id ? acc2.id : acc1.id),
                    category: 'transfer', paymentMode: t.paymentMode || 'Net Banking', note: t.note || '',
                });
            } else {
                data.transactions.push({
                    id: generateId(), type: t.type, amount: Number(t.amount), date: t.date,
                    accountId: accId(t.account), category: t.category || (t.type === 'Income' ? 'other_income' : 'misc'),
                    paymentMode: t.paymentMode || 'UPI', note: [t.subCategory, t.note].filter(Boolean).join(' - '),
                });
            }
        });

        data.recurring = this.read('recurring', []).map(r => ({
            id: generateId(), name: r.name, amount: Number(r.amount), category: r.category,
            accountId: accId(r.account), frequency: r.frequency || 'Monthly', debitDay: Number(r.debitDay) || 1, isActive: r.isActive !== false,
        }));
        data.budgets = this.read('budgets', []).map(b => ({ id: generateId(), month: b.month, category: b.category, amount: Number(b.amount) }));
        return data;
    },

    clear() {
        Object.keys(localStorage).filter(k => k.startsWith('expenseApp_')).forEach(k => localStorage.removeItem(k));
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
