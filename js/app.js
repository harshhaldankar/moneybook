/* ========================================
   MONEYBOOK - App logic (views, forms, charts)
   ======================================== */

const TOP_VIEWS = ['home', 'activity', 'savings', 'more'];
const VIEW_TITLES = {
    home: 'MoneyBook', activity: 'Activity', savings: 'Savings', more: 'More',
    accounts: 'Bank accounts', budgets: 'Budgets', recurring: 'Auto-debits', reports: 'Reports', profile: 'Profile and security',
    automation: 'Share SMS & Reminders',
};
const IDLE_LOCK_MS = 10 * 60 * 1000;
const SYNC_INTERVAL_MS = 60 * 1000;

class App {
    constructor() {
        this.view = 'home';
        this.month = currentMonthKey();
        this.filters = { account: 'all', type: 'all', search: '' };
        this.charts = {};
        this.idleTimer = null;
        this.pendingCaptures = [];
        this.update = null;      // newer APK on GitHub, if any
        this.appVersion = null;
    }

    get data() { return Store.data; }

    async init() {
        this.bindAuth();
        this.bindShell();
        Store.onStateChange = () => this.renderSyncState();
        Store.onChange = () => { this.render(); Native.scheduleReminders(this.data); };
        Store.onAuthError = () => { Store.forget(); this.showAuth(); this.toast('Session expired. Please log in again.', 'error'); };

        // A shared link like ...?api=<web app url> sets up the Sheet connection for family members
        const apiParam = new URLSearchParams(location.search).get('api');
        if (apiParam && Api.isValidUrl(apiParam)) {
            Api.url = apiParam;
            history.replaceState(null, '', location.pathname);
        }

        await Native.init(this);
        if (Store.resume()) this.enterApp();
        else this.showAuth(localStorage.getItem(Store.CURRENT_KEY) || '');

        setInterval(() => { if (Store.userId && document.visibilityState === 'visible') Store.flush(); }, SYNC_INTERVAL_MS);
        window.addEventListener('online', () => Store.flush());

        if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !Native.isNative) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }

    /* ========== AUTH ========== */
    bindAuth() {
        document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.auth)));

        document.querySelectorAll('.pw-toggle').forEach(btn => btn.addEventListener('click', () => {
            const input = btn.previousElementSibling;
            input.type = input.type === 'password' ? 'text' : 'password';
            btn.innerHTML = `<i class="fas fa-eye${input.type === 'password' ? '' : '-slash'}"></i>`;
        }));

        document.getElementById('connectForm').addEventListener('submit', async e => {
            e.preventDefault();
            const url = document.getElementById('apiUrl').value.trim();
            this.showAuthError('connectError', '');
            if (!Api.isValidUrl(url)) {
                this.showAuthError('connectError', 'That doesn\'t look like an Apps Script web app link (it starts with https://script.google.com/macros/s/)');
                return;
            }
            await this.withBusy(e.target.querySelector('button[type=submit]'), 'Connecting…', async () => {
                const previous = Api.url;
                try {
                    Api.url = url;
                    await Api.call('ping');
                    this.toast('Google Sheet connected', 'success');
                    this.showAuth();
                } catch (err) {
                    Api.url = previous;
                    this.showAuthError('connectError', err.message);
                }
            });
        });
        document.getElementById('changeServer').addEventListener('click', () => this.showConnect(true));
        document.getElementById('bioUnlock').addEventListener('click', () => this.bioUnlock());
        document.getElementById('connectCancel').addEventListener('click', () => this.showAuth());

        document.getElementById('loginForm').addEventListener('submit', async e => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            const user = document.getElementById('loginUser').value;
            const pass = document.getElementById('loginPass').value;
            this.showAuthError('loginError', '');
            await this.withBusy(btn, 'Checking…', async () => {
                try {
                    // Already logged in on this device → unlock offline; otherwise ask the Sheet
                    if (!await Store.unlock(user, pass)) await Store.login(user, pass);
                    this.enterApp();
                    Store.flush();
                    this.offerBiometric();
                } catch (err) {
                    this.showAuthError('loginError', err.message);
                }
            });
        });

        document.getElementById('signupForm').addEventListener('submit', async e => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            const name = document.getElementById('signupName').value.trim();
            const pass = document.getElementById('signupPass').value;
            if (pass !== document.getElementById('signupPass2').value) {
                this.showAuthError('signupError', 'Passwords do not match');
                return;
            }
            this.showAuthError('signupError', '');
            await this.withBusy(btn, 'Creating…', async () => {
                try {
                    await Store.register(document.getElementById('signupUser').value, name, pass);
                    this.enterApp();
                    if (!this.data.accounts.length) this.openAccountSheet(null, true);
                } catch (err) {
                    this.showAuthError('signupError', err.message);
                }
            });
        });
    }

    async withBusy(btn, label, fn) {
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label}`;
        try { await fn(); } finally { btn.disabled = false; btn.innerHTML = original; }
    }

    switchAuthTab(which) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.auth === which));
        document.getElementById('loginForm').hidden = which !== 'login';
        document.getElementById('signupForm').hidden = which !== 'signup';
    }

    showAuthError(id, msg) {
        document.getElementById(id).textContent = msg;
    }

    showConnect(canCancel = false) {
        document.getElementById('connectForm').hidden = false;
        document.getElementById('apiUrl').value = Api.url;
        document.getElementById('connectCancel').hidden = !canCancel;
        ['authTabs', 'loginForm', 'signupForm', 'serverLine'].forEach(id => { document.getElementById(id).hidden = true; });
    }

    showAuth(prefillUser = '') {
        document.getElementById('app').hidden = true;
        document.getElementById('authScreen').hidden = false;
        this.closeSheet();
        document.querySelectorAll('.auth-form').forEach(f => f.reset());
        if (!Api.url) { this.showConnect(); return; }
        document.getElementById('connectForm').hidden = true;
        document.getElementById('authTabs').hidden = false;
        document.getElementById('serverLine').hidden = !Api.isCustom;

        const sessions = Store.getSessions();
        const ids = Object.keys(sessions);
        document.getElementById('savedUsers').innerHTML = ids.length ? `
            <span class="saved-users-label">On this device</span>
            <div class="saved-users-list">${ids.map(id => `
                <button type="button" class="user-chip" data-user="${escapeHtml(id)}">
                    <span class="avatar sm">${escapeHtml(this.initials(sessions[id].displayName))}</span>
                    <span><b>${escapeHtml(sessions[id].displayName)}</b><small>@${escapeHtml(id)}</small></span>
                </button>`).join('')}
            </div>` : '';
        document.querySelectorAll('.user-chip').forEach(chip => chip.addEventListener('click', () => {
            document.getElementById('loginUser').value = chip.dataset.user;
            document.getElementById('loginPass').focus();
        }));
        this.switchAuthTab(ids.length ? 'login' : 'signup');
        if (prefillUser) {
            this.switchAuthTab('login');
            document.getElementById('loginUser').value = prefillUser;
            document.getElementById('loginPass').focus();
        }
        // Fingerprint / face unlock for the person who last used this phone
        const bioUser = prefillUser || (ids.length === 1 ? ids[0] : '');
        const bioBtn = document.getElementById('bioUnlock');
        bioBtn.hidden = !(bioUser && Native.bioEnabled(bioUser));
        if (!bioBtn.hidden) {
            this.bioUser = bioUser;
            this.switchAuthTab('login');
            document.getElementById('loginUser').value = bioUser;
            Native.biometry().then(b => { bioBtn.querySelector('span').textContent = `Unlock with ${b.label || 'fingerprint'}`; });
            clearTimeout(this.bioTimer);
            this.bioTimer = setTimeout(() => this.bioUnlock(), 350);
        }
    }

    async bioUnlock() {
        const id = this.bioUser;
        if (!id || !Native.bioEnabled(id) || this.bioBusy || Store.userId) return;
        this.bioBusy = true;
        try {
            if (await Native.biometricCheck(`Signed in as @${id}`) && Store.unlockTrusted(id)) {
                this.enterApp();
                Store.flush();
            }
        } finally {
            this.bioBusy = false;
        }
    }

    /** After a password login on the phone, offer fingerprint unlock once. */
    async offerBiometric() {
        const id = Store.userId;
        if (!Native.isNative || Native.bioEnabled(id) || localStorage.getItem(`mb_bio_asked_${id}`)) return;
        const bio = await Native.biometry();
        if (!bio.available) return;
        localStorage.setItem(`mb_bio_asked_${id}`, '1');
        if (await this.confirm(`Unlock with ${bio.label}?`, `Next time, open MoneyBook with your ${bio.label} instead of typing your password. You can change this in Profile.`, 'Turn on')
            && await Native.biometricCheck(`Confirm it's you to turn on ${bio.label} unlock`)) {
            Native.setBio(id, true);
            this.toast(`${bio.label[0].toUpperCase()}${bio.label.slice(1)} unlock is on`, 'success');
        }
    }

    enterApp() {
        document.getElementById('authScreen').hidden = true;
        document.getElementById('app').hidden = false;
        document.getElementById('avatarBtn').textContent = this.initials(this.data.profile.displayName);
        this.month = currentMonthKey();
        this.navigate('home');
        this.renderSyncState();
        this.resetIdleTimer();
        Store.flush();
        Native.onLogin(this.data);
        this.refreshUpdate();
        if (Store.importedPrevious) {
            Store.importedPrevious = false;
            this.toast('Your earlier data was moved into the Google Sheet', 'success');
        }
    }

    lock() {
        const user = Store.userId;
        Store.lock();
        this.destroyCharts();
        this.showAuth(user);
        this.toast('Locked. Enter your password to continue.');
    }

    logout() {
        Store.lock();
        localStorage.removeItem(Store.CURRENT_KEY);
        this.destroyCharts();
        this.showAuth();
    }

    resetIdleTimer() {
        clearTimeout(this.idleTimer);
        if (!Store.userId || this.data.settings.lockOnOpen === false) return;
        this.idleTimer = setTimeout(() => this.lock(), IDLE_LOCK_MS);
    }

    initials(name) {
        return String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    }

    renderSyncState() {
        const btn = document.getElementById('syncBtn');
        const badge = document.getElementById('syncBadge');
        if (!btn || !Store.userId) return;
        const pending = Store.pendingCount();
        const icons = { syncing: 'fa-rotate fa-spin', offline: 'fa-cloud-arrow-up', error: 'fa-triangle-exclamation', idle: 'fa-cloud' };
        btn.querySelector('i').className = `fas ${icons[Store.syncState] || 'fa-cloud'}`;
        btn.title = Store.syncState === 'offline' ? `Offline · ${pending} change${pending === 1 ? '' : 's'} waiting to sync`
            : Store.syncState === 'error' ? 'Sync problem · tap to retry' : Store.syncState === 'syncing' ? 'Syncing…' : 'Synced with Google Sheet';
        badge.hidden = !pending;
        badge.textContent = pending;
    }

    /* ========== SHELL / NAVIGATION ========== */
    bindShell() {
        document.querySelectorAll('.nav-item').forEach(a => a.addEventListener('click', e => {
            e.preventDefault();
            this.navigate(a.dataset.view);
        }));
        document.getElementById('backBtn').addEventListener('click', () => this.navigate('more'));
        document.getElementById('lockBtn').addEventListener('click', () => this.lock());
        document.getElementById('syncBtn').addEventListener('click', () => { Store.flush(); this.toast(Store.syncState === 'offline' ? 'Offline. Changes will sync when you\'re back online.' : 'Syncing with Google Sheet…'); });
        document.getElementById('avatarBtn').addEventListener('click', () => this.navigate('profile'));
        document.getElementById('sheetClose').addEventListener('click', () => this.closeSheet());
        document.getElementById('sheetOverlay').addEventListener('click', e => { if (e.target.id === 'sheetOverlay') this.closeSheet(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeSheet(); });
        ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => this.resetIdleTimer(), { passive: true }));

        // One delegated handler for every [data-action] in the app and sheet
        document.addEventListener('click', e => {
            const el = e.target.closest('[data-action]');
            if (!el || !Store.data) return;
            e.preventDefault();
            this.handleAction(el.dataset.action, el.dataset, el);
        });
    }

    navigate(view) {
        this.view = view;
        document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
        const navTarget = TOP_VIEWS.includes(view) ? view : 'more';
        document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.view === navTarget));
        document.getElementById('appTitle').textContent = VIEW_TITLES[view];
        document.getElementById('backBtn').hidden = TOP_VIEWS.includes(view);
        document.getElementById('content').scrollTop = 0;
        window.scrollTo(0, 0);
        this.render();
    }

    render() {
        if (!Store.data) return;
        const renderers = {
            home: () => this.renderHome(), activity: () => this.renderActivity(), savings: () => this.renderSavings(),
            more: () => this.renderMore(), accounts: () => this.renderAccounts(), budgets: () => this.renderBudgets(),
            recurring: () => this.renderRecurring(), reports: () => this.renderReports(), profile: () => this.renderProfile(),
            automation: () => this.renderAutomation(),
        };
        renderers[this.view]();
    }

    async persist(message) {
        await Store.save();
        this.render();
        this.renderSyncState();
        Native.scheduleReminders(this.data);
        Native.checkBudgetAlerts(this.data);
        if (message) this.toast(message, 'success');
    }

    handleAction(action, ds) {
        const actions = {
            'add-txn': () => this.openTxnSheet(null, ds.type || 'Expense'),
            'edit-txn': () => this.openTxnSheet(this.data.transactions.find(t => t.id === ds.id)),
            'add-account': () => this.openAccountSheet(null),
            'edit-account': () => this.openAccountSheet(this.data.accounts.find(a => a.id === ds.id)),
            'filter-account': () => { this.filters.account = ds.id; this.navigate('activity'); },
            'month-prev': () => { this.month = shiftMonth(this.month, -1); this.render(); },
            'month-next': () => { this.month = shiftMonth(this.month, 1); this.render(); },
            'month-set': () => { this.month = ds.month; this.render(); },
            'go': () => this.navigate(ds.view),
            'toggle-hide': () => {
                try { localStorage.setItem('mb_hide_balances', this.hideBalances ? '0' : '1'); } catch { /* storage unavailable */ }
                this.render();
            },
            'edit-target': () => this.openTargetSheet(),
            'add-budget': () => this.openBudgetSheet(null),
            'edit-budget': () => this.openBudgetSheet(this.data.budgets.find(b => b.id === ds.id)),
            'copy-budgets': () => this.copyLastMonthBudgets(),
            'add-recurring': () => this.openRecurringSheet(null),
            'edit-recurring': () => this.openRecurringSheet(this.data.recurring.find(r => r.id === ds.id)),
            'pay-recurring': () => this.payRecurring(ds.id),
            'change-password': () => this.openPasswordSheet(),
            'edit-name': () => this.openNameSheet(),
            'export': () => this.exportData(),
            'export-csv': () => this.exportCsv(),
            'import': () => document.getElementById('importFile').click(),
            'delete-profile': () => this.openDeleteProfileSheet(),
            'review-capture': () => this.openTxnSheet(null, 'Expense', this.pendingCaptures.find(c => c.captureId === ds.id)),
            'save-capture': () => this.quickSaveCapture(ds.id),
            'ignore-capture': () => this.ignoreCapture(ds.id),
            'enable-notifications': () => Native.requestNotificationPermission().then(() => this.render()),
            'test-notification': () => Native.testNotification(),
            'copy-share-link': () => this.copyShareLink(),
            'paste-sms': () => this.pasteSms(),
            'import-statement': () => this.openStatementSheet(),
            'install-update': () => this.update && Native.openUpdate(this.update.url),
            'dismiss-update': () => {
                try { localStorage.setItem('mb_update_dismissed', this.update.version); } catch { /* ignore */ }
                this.render();
            },
            'check-update': async () => {
                this.toast('Checking for updates…');
                await this.refreshUpdate(true);
                if (!this.update) this.toast(`You're on the latest version${this.appVersion ? ` (${this.appVersion})` : ''}`, 'success');
            },
            'lock': () => this.lock(),
            'logout': () => this.logout(),
        };
        if (actions[action]) actions[action]();
    }

    monthSwitcher() {
        const isCurrent = this.month === currentMonthKey();
        return `
            <div class="month-switcher">
                <button class="icon-btn" data-action="month-prev" aria-label="Previous month"><i class="fas fa-chevron-left"></i></button>
                <span>${monthLabel(this.month)}</span>
                <button class="icon-btn" data-action="month-next" aria-label="Next month"><i class="fas fa-chevron-right"></i></button>
                ${isCurrent ? '' : `<button class="chip-btn" data-action="month-set" data-month="${currentMonthKey()}">Today</button>`}
            </div>`;
    }

    accountById(id) { return this.data.accounts.find(a => a.id === id); }
    accountName(id) { return this.accountById(id)?.name || 'Deleted account'; }
    activeAccounts() { return this.data.accounts.filter(a => !a.archived); }

    /* ========== HOME ========== */
    /* ========== APP UPDATES ========== */
    async refreshUpdate(force = false) {
        if (!Native.isNative) return;
        const info = await Native.appInfo();
        this.appVersion = info?.version || null;
        const found = await Native.checkForUpdate(force);
        const changed = JSON.stringify(found) !== JSON.stringify(this.update);
        this.update = found;
        if (force && found) localStorage.removeItem('mb_update_dismissed');
        if (changed || force) this.render();
    }

    updateCard() {
        const u = this.update;
        let dismissed = null;
        try { dismissed = localStorage.getItem('mb_update_dismissed'); } catch { /* ignore */ }
        if (!u || dismissed === u.version) return '';
        return `
            <div class="card update-card">
                <span class="update-icon"><i class="fas fa-arrow-down"></i></span>
                <div class="update-text">
                    <b>Update available · v${escapeHtml(u.version)}</b>
                    <small>${escapeHtml(u.notes || 'Improvements and fixes')}</small>
                </div>
                <div class="update-actions">
                    <button class="btn btn-primary sm" data-action="install-update">Update</button>
                    <button class="link-btn" data-action="dismiss-update">Later</button>
                </div>
            </div>`;
    }

    /** Balances can be hidden on screen (like a bank app); stored per device. */
    get hideBalances() {
        try { return localStorage.getItem('mb_hide_balances') === '1'; } catch { return false; }
    }

    money(amount) {
        return this.hideBalances ? '₹ ••••••' : formatCurrency(amount);
    }

    /** Ring showing progress to the savings target (or savings rate when no target is set). */
    savingsRing(s) {
        const hasTarget = s.target > 0;
        const pct = hasTarget ? (s.targetPct ?? 0) : (s.savingsRate ?? 0);
        const shown = Math.max(0, Math.min(pct, 100));
        const r = 42, c = 2 * Math.PI * r;
        const done = hasTarget && s.saved >= s.target;
        return `
            <button class="ring ${done ? 'done' : ''} ${s.saved < 0 ? 'negative' : ''}" data-action="edit-target" aria-label="Savings target">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                    <circle class="ring-track" cx="50" cy="50" r="${r}"></circle>
                    <circle class="ring-fill" cx="50" cy="50" r="${r}" stroke-dasharray="${(shown / 100) * c} ${c}"></circle>
                </svg>
                <span class="ring-center">
                    <b>${done ? '<i class="fas fa-check"></i>' : `${Math.round(pct)}%`}</b>
                    <small>${hasTarget ? (done ? 'Target hit' : 'of target') : 'saved'}</small>
                </span>
            </button>`;
    }

    renderHome() {
        const d = this.data;
        const el = document.getElementById('view-home');
        const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
        const header = `
            <div class="home-head">
                <div>
                    <p class="greeting">${today}</p>
                </div>
            </div>`;

        if (!d.accounts.length) {
            el.innerHTML = `
                ${header}
                <div class="card empty-hero">
                    <div class="empty-icon"><i class="fas fa-building-columns"></i></div>
                    <h2>Add your first account</h2>
                    <p>Start with the account your salary comes into. You can add more later: daily-use account, cash wallet, credit card.</p>
                    <button class="btn btn-primary" data-action="add-account"><i class="fas fa-plus"></i> Add account</button>
                </div>`;
            return;
        }

        const split = Calc.balanceSplit(d);
        const s = Calc.monthStats(d, this.month);
        const accounts = this.activeAccounts();
        const others = Math.max(accounts.length - 1, 0);
        const mainPct = split.total > 0 ? Math.max(0, Math.min(100, (split.mainBal / split.total) * 100)) : 100;
        const isCurrent = this.month === currentMonthKey();

        el.innerHTML = `
            ${header}

            ${this.updateCard()}
            ${this.capturesCard()}

            <div class="hero-card">
                <div class="hero-top">
                    <span class="hero-label">Total balance</span>
                    <button class="hero-eye" data-action="toggle-hide" aria-label="${this.hideBalances ? 'Show' : 'Hide'} balances"><i class="fas ${this.hideBalances ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                </div>
                <span class="hero-value">${this.money(split.total)}</span>
                <div class="hero-bar" aria-hidden="true"><span style="width:${mainPct}%"></span></div>
                <div class="hero-split">
                    <div>
                        <span class="hero-sub"><i class="dot main"></i>Main · ${escapeHtml(split.main?.name || '-')}</span>
                        <b>${this.money(split.mainBal)}</b>
                    </div>
                    <div>
                        <span class="hero-sub"><i class="dot other"></i>${others ? `${others} other account${others === 1 ? '' : 's'}` : 'Other accounts'}</span>
                        <b>${this.money(split.othersBal)}</b>
                    </div>
                </div>
            </div>

            <div class="quick-actions">
                <button data-action="add-txn" data-type="Expense"><span class="qa-icon expense"><i class="fas fa-arrow-up"></i></span>Expense</button>
                <button data-action="add-txn" data-type="Income"><span class="qa-icon income"><i class="fas fa-arrow-down"></i></span>Income</button>
                <button data-action="add-txn" data-type="Transfer"><span class="qa-icon transfer"><i class="fas fa-arrow-right-arrow-left"></i></span>Transfer</button>
                <button data-action="paste-sms"><span class="qa-icon paste"><i class="fas fa-paste"></i></span>Paste SMS</button>
            </div>

            <div class="section-head">
                <h3>Accounts</h3>
                <button class="link-btn" data-action="go" data-view="accounts">Manage</button>
            </div>
            <div class="account-scroller">
                ${accounts.map(a => `
                    <button class="account-chip" data-action="filter-account" data-id="${a.id}" style="--acc:${a.color}">
                        <span class="acc-top">
                            <span class="acc-badge">${escapeHtml((a.bank || a.name).trim().charAt(0).toUpperCase())}</span>
                            ${a.isMain ? '<span class="acc-main"><i class="fas fa-star"></i> Main</span>' : ''}
                        </span>
                        <span class="acc-name">${escapeHtml(a.name)}</span>
                        <span class="acc-type">${escapeHtml(a.bank || a.type)}${a.last4 ? ` ••${escapeHtml(String(a.last4).split(/[\s,]+/)[0].slice(-4))}` : ''}</span>
                        <span class="acc-bal">${this.money(Calc.accountBalance(d, a))}</span>
                    </button>`).join('')}
                <button class="account-chip add" data-action="add-account"><i class="fas fa-plus"></i><span>Add account</span></button>
            </div>

            <div class="card month-card">
                <div class="month-card-head">
                    <button class="icon-btn sm" data-action="month-prev" aria-label="Previous month"><i class="fas fa-chevron-left"></i></button>
                    <h3>${isCurrent ? 'This month' : monthLabel(this.month)}</h3>
                    <button class="icon-btn sm" data-action="month-next" aria-label="Next month"><i class="fas fa-chevron-right"></i></button>
                </div>
                <div class="month-body">
                    ${this.savingsRing(s)}
                    <div class="month-stats">
                        <div><span><i class="dot income"></i>Income</span><b>${formatCurrency(s.income)}</b></div>
                        <div><span><i class="dot expense"></i>Spent</span><b>${formatCurrency(s.spent)}</b></div>
                        <div class="saved-line"><span>Saved</span><b class="${s.saved < 0 ? 'expense-c' : 'income-c'}">${formatCurrency(s.saved)}</b></div>
                    </div>
                </div>
                ${s.target ? `<p class="month-note">${s.saved >= s.target ? `${formatCurrency(s.saved - s.target)} above your ${formatCurrency(s.target)} target` : `${formatCurrency(s.target - s.saved)} more to reach your ${formatCurrency(s.target)} target`}</p>`
                    : `<button class="target-empty" data-action="edit-target"><i class="fas fa-bullseye"></i> Set a monthly savings target</button>`}
                <div class="carry-row">
                    <div><span>Carried in</span><b>${this.money(s.openingBalance)}</b></div>
                    <i class="fas fa-arrow-right"></i>
                    <div><span>Carry forward</span><b>${this.money(s.closingBalance)}</b></div>
                </div>
                <button class="link-btn" data-action="go" data-view="savings">Month-on-month savings <i class="fas fa-arrow-right"></i></button>
            </div>

            ${this.budgetAlerts()}
            ${this.upcomingRecurringCard()}

            <div class="card">
                <div class="card-header">
                    <h3>Recent</h3>
                    <button class="link-btn" data-action="go" data-view="activity">See all</button>
                </div>
                ${this.txnListHtml([...d.transactions].sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '') || b.id.localeCompare(a.id)).slice(0, 6), false)}
            </div>`;
    }

    /* ========== PASTE A BANK SMS ========== */
    /** Reads the clipboard: bank SMS go straight to review, anything else shows the paste box. */
    async pasteSms() {
        if (!this.activeAccounts().length) { this.toast('Add a bank account first', 'error'); this.openAccountSheet(null, true); return; }
        const text = (await Native.readClipboard()).trim();
        if (text) {
            const r = Capture.draftsFromText(this.data, text);
            if (r.drafts.length) { this.reviewDrafts(r.drafts, 'Pasted SMS'); return; }
            if (r.sensitive) { this.toast('Copied text looks like an OTP or code, so it was not used', 'error'); this.openPasteSheet(); return; }
        }
        this.openPasteSheet(text && text.length < 4000 && !TxnParser.isSensitive(text) ? text : '');
    }

    /**
     * Bank SMS state the balance after each payment ("Total Bal Rs. 837.18"). If MoneyBook's
     * balance at that moment differs, offer to correct the account's starting balance.
     */
    async checkBankBalance(entries) {
        const known = entries.filter(e => e.accountId && typeof e.balanceAfter === 'number' && isFinite(e.balanceAfter))
            .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
        const last = known[known.length - 1];
        const acc = last && this.accountById(last.accountId);
        if (!acc) return;
        const ours = Calc.accountBalanceAt(this.data, acc, last.date, last.time);
        const diff = Math.round((last.balanceAfter - ours) * 100) / 100;
        if (Math.abs(diff) < 1) return;
        const ok = await this.confirm('Balance doesn\'t match your bank',
            `Your bank says ${formatCurrency(last.balanceAfter)} after this transaction, but MoneyBook shows ${formatCurrency(ours)} (${diff > 0 ? '+' : ''}${formatCurrency(diff)}). `
            + `Usually the starting balance is off or some payments weren't added. Correct ${acc.name}'s starting balance so it matches the bank?`, 'Fix balance');
        if (!ok) return;
        // A sync may have refreshed the data while the dialog was open: work on the current account
        const live = this.accountById(last.accountId);
        if (!live) return;
        const now = Calc.accountBalanceAt(this.data, live, last.date, last.time);
        // Starting balance that makes MoneyBook equal the bank at that moment
        const openingCounted = live.openingDate <= last.date ? Number(live.openingBalance) || 0 : 0;
        live.openingBalance = Math.round((last.balanceAfter - (now - openingCounted)) * 100) / 100;
        if (live.openingDate > last.date) live.openingDate = last.date;
        await this.persist(`${live.name} now matches your bank: ${formatCurrency(Calc.accountBalance(this.data, live))}`);
    }

    /** One draft → the normal review sheet; several (or a duplicate) → the checklist. */
    reviewDrafts(drafts, title) {
        if (drafts.length === 1 && !drafts[0].duplicate) this.openTxnSheet(null, 'Expense', drafts[0]);
        else this.openBatchSheet(drafts, title);
    }

    openPasteSheet(prefill = '') {
        this.openSheet('Paste bank SMS', `
            <div class="sheet-form">
                <ol class="steps">
                    <li>In your SMS app, long-press the bank message (or select several) → <b>Copy</b></li>
                    <li>Come back here and paste it below</li>
                </ol>
                <textarea id="pasteText" rows="5" placeholder="e.g. Sent Rs.249.00 From HDFC Bank A/C *4521 To SWIGGY On 08/11/26">${escapeHtml(prefill)}</textarea>
                <div class="paste-preview" id="pastePreview"></div>
                <div class="btn-row">
                    <button type="button" class="btn btn-secondary" id="pasteFromClipboard"><i class="fas fa-paste"></i> Paste</button>
                    <button type="button" class="btn btn-primary grow" id="pasteContinue" disabled><i class="fas fa-arrow-right"></i> Continue</button>
                </div>
                ${Native.isNative ? `
                <div class="or-divider"><span>or</span></div>
                <button type="button" class="btn btn-secondary btn-block" id="scanShot"><i class="fas fa-image"></i> Scan a screenshot</button>
                <input type="file" id="scanFile" accept="image/*" hidden>
                <p class="hint">Screenshot your SMS app (several messages are fine) or a GPay / PhonePe / Paytm payment screen. The image is read on your phone and not saved.</p>` : ''}
                <p class="hint"><i class="fas fa-shield-halved"></i> Only the amount, account digits, merchant, date and UPI ref are used. OTPs are refused and the message itself isn't saved.</p>
            </div>`, body => {
            const area = body.querySelector('#pasteText');
            const preview = body.querySelector('#pastePreview');
            const cont = body.querySelector('#pasteContinue');
            let result = null;
            const update = () => {
                const text = area.value.trim();
                result = text ? Capture.draftsFromText(this.data, text) : null;
                const n = result?.drafts.length || 0;
                cont.disabled = !n;
                if (!text) { preview.innerHTML = ''; return; }
                if (!n && result.sensitive) { preview.innerHTML = '<span class="expense-c"><i class="fas fa-ban"></i> Looks like an OTP or code, so it can\'t be used</span>'; return; }
                if (!n) { preview.innerHTML = '<span class="muted"><i class="fas fa-circle-question"></i> No debit or credit found yet</span>'; return; }
                if (n > 1) { preview.innerHTML = `<span class="income-c"><i class="fas fa-check"></i> ${n} transactions found</span>`; return; }
                const d = result.drafts[0];
                preview.innerHTML = `<span class="${d.type === 'Income' ? 'income-c' : 'expense-c'}"><i class="fas fa-check"></i> ${d.type === 'Income' ? 'Received' : 'Spent'} ${formatCurrency(d.amount)}</span>${d.note ? ` · ${escapeHtml(displayName(d.note))}` : ''} · ${friendlyDate(d.date)}`;
            };
            area.addEventListener('input', update);
            body.querySelector('#pasteFromClipboard').addEventListener('click', async () => {
                const text = await Native.readClipboard();
                if (!text) { this.toast('Clipboard is empty. Copy the SMS first.', 'error'); return; }
                area.value = TxnParser.isSensitive(text) && !Capture.draftsFromText(this.data, text).drafts.length ? '' : text;
                if (!area.value) this.toast('Copied text looks like an OTP or code, so it was not used', 'error');
                update();
            });
            cont.addEventListener('click', () => { if (result?.drafts.length) this.reviewDrafts(result.drafts, 'Pasted SMS'); });
            body.querySelector('#scanShot')?.addEventListener('click', () => body.querySelector('#scanFile').click());
            body.querySelector('#scanFile')?.addEventListener('change', e => this.scanScreenshot(e.target.files[0], body.querySelector('#scanShot')));
            update();
            if (!prefill) setTimeout(() => area.focus(), 250);
        });
    }

    async scanScreenshot(file, btn) {
        if (!file) return;
        await this.withBusy(btn, 'Reading…', async () => {
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(r.result);
                    r.onerror = () => reject(new Error('Couldn\'t open that image'));
                    r.readAsDataURL(file);
                });
                const { text, blocks } = await Native.scanImage(dataUrl);
                this.showScanResult(text || '', blocks || []);
            } catch (err) {
                this.toast(err.message || 'Couldn\'t read that screenshot', 'error');
            }
        });
    }

    showScanResult(text, blocks) {
        const r = Capture.draftsFromScreenshot(this.data, text, blocks);
        if (r.drafts.length) { this.reviewDrafts(r.drafts, 'From screenshot'); return; }
        this.toast(r.sensitive ? 'That screenshot only shows an OTP or code, so it was not used' : 'No payment found in that screenshot', 'error');
    }

    /** A screenshot shared to MoneyBook from the gallery / screenshot tool. */
    async checkSharedScan() {
        if (!Store.data) return;
        const scan = await Native.takeScan();
        if (scan && (scan.text || scan.blocks?.length)) this.showScanResult(scan.text || '', scan.blocks || []);
    }

    /** Checklist for several detected transactions (screenshot / multi-SMS paste). */
    openBatchSheet(drafts, title) {
        drafts.forEach((d, i) => { d.key = `d${i}`; d.selected = !d.duplicate; });
        const fallback = Calc.mainAccount(this.data);
        const needAccount = drafts.some(d => !d.accountId);
        const timeLabel = t => t ? new Date(`2000-01-01T${t}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
        this.openSheet(title, `
            <div class="sheet-form">
                <div class="statement-summary">
                    <b>${drafts.length} transaction${drafts.length === 1 ? '' : 's'} found</b>
                    ${drafts.some(d => d.duplicate) ? `<small><i class="fas fa-clone"></i> ${drafts.filter(d => d.duplicate).length} already in MoneyBook (unticked)</small>` : ''}
                </div>
                ${needAccount ? `<div class="form-group"><label for="batchAccount">Account for entries without a matching account</label><select id="batchAccount">${this.accountOptions(fallback.id)}</select></div>` : ''}
                <div class="statement-list">
                    ${drafts.map(d => `
                        <label class="statement-row ${d.selected ? '' : 'off'}">
                            <input type="checkbox" data-key="${d.key}" ${d.selected ? 'checked' : ''}>
                            <span class="txn-main">
                                <b>${escapeHtml(displayName(d.note) || (d.type === 'Income' ? 'Money received' : 'UPI payment'))}</b>
                                <small>${friendlyDate(d.date)}${d.time ? ` · ${timeLabel(d.time)}` : ''} · ${escapeHtml(getCategory(d.category || (d.type === 'Income' ? 'other_income' : 'misc')).name)}${d.accountId ? ` · ${escapeHtml(this.accountName(d.accountId))}` : ''}${d.refNo ? ` · Ref …${escapeHtml(d.refNo.slice(-4))}` : ''}
                                ${d.duplicate ? `<br><span class="warn-c">${d.duplicate.kind === 'ref' ? 'Already added (same UPI ref)' : 'Possibly already added'}</span>` : ''}</small>
                            </span>
                            <span class="txn-amt ${d.type === 'Income' ? 'income-c' : 'expense-c'}">${d.type === 'Income' ? '+' : '-'}${formatCurrency(d.amount)}</span>
                        </label>`).join('')}
                </div>
                <p class="hint">Categories are guessed from the merchant. You can change any entry later in Activity.</p>
                <div class="btn-row sticky-actions">
                    <button type="button" class="btn btn-primary grow" id="batchAdd"></button>
                </div>
            </div>`, body => {
            const btn = body.querySelector('#batchAdd');
            const update = () => {
                const n = drafts.filter(d => d.selected).length;
                btn.disabled = !n;
                btn.innerHTML = `<i class="fas fa-check"></i> Add ${n} transaction${n === 1 ? '' : 's'}`;
            };
            body.querySelectorAll('[data-key]').forEach(cb => cb.addEventListener('change', () => {
                drafts.find(d => d.key === cb.dataset.key).selected = cb.checked;
                cb.closest('.statement-row').classList.toggle('off', !cb.checked);
                update();
            }));
            btn.addEventListener('click', async () => {
                const accountFallback = body.querySelector('#batchAccount')?.value || fallback.id;
                const chosen = drafts.filter(d => d.selected);
                chosen.forEach(d => {
                    this.data.transactions.push(this.draftToTxn({
                        ...d,
                        accountId: d.accountId || accountFallback,
                        category: d.category || (d.type === 'Income' ? 'other_income' : 'misc'),
                    }));
                });
                this.closeSheet();
                await this.persist(`${chosen.length} transaction${chosen.length === 1 ? '' : 's'} added`);
                await this.checkBankBalance(chosen.map(d => ({ ...d, accountId: d.accountId || accountFallback })));
            });
            update();
        });
    }

    /* ========== BANK STATEMENT IMPORT ========== */
    openStatementSheet() {
        if (!this.activeAccounts().length) { this.toast('Add a bank account first', 'error'); this.openAccountSheet(null, true); return; }
        const main = Calc.mainAccount(this.data);
        this.openSheet('Import bank statement', `
            <div class="sheet-form">
                <div class="form-group">
                    <label for="stAccount">Which account is this statement for?</label>
                    <select id="stAccount">${this.accountOptions(main.id)}</select>
                </div>
                <label class="file-drop" for="stFile">
                    <i class="fas fa-file-excel"></i>
                    <b>Choose statement file</b>
                    <small>Excel (.xls, .xlsx) or CSV, downloaded from net banking</small>
                    <input type="file" id="stFile" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
                </label>
                <p class="hint"><i class="fas fa-circle-info"></i> In net banking, open the account statement, pick the dates, and download as <b>Excel</b> or <b>CSV</b>. PDF statements aren't supported yet. The file is read on this device; only the transactions you import are saved.</p>
                <div id="stResult"></div>
            </div>`, body => {
            body.querySelector('#stFile').addEventListener('change', e => this.readStatement(e.target.files[0], body));
            body.querySelector('#stAccount').addEventListener('change', () => { if (this.statementRows) this.renderStatement(body); });
        });
    }

    async readStatement(file, body) {
        if (!file) return;
        const result = body.querySelector('#stResult');
        result.innerHTML = `<p class="hint"><i class="fas fa-spinner fa-spin"></i> Reading ${escapeHtml(file.name)}…</p>`;
        try {
            const parsed = await Statement.read(file);
            this.statementRows = parsed.rows;
            this.statementFile = file.name;
            this.renderStatement(body);
        } catch (err) {
            this.statementRows = null;
            result.innerHTML = `<p class="auth-error">${escapeHtml(err.message)}</p>`;
        }
    }

    renderStatement(body) {
        const accountId = body.querySelector('#stAccount').value;
        const drafts = Statement.toDrafts(this.data, accountId, this.statementRows);
        this.statementDrafts = drafts;
        const result = body.querySelector('#stResult');
        const dups = drafts.filter(d => d.duplicate).length;
        const early = drafts.filter(d => d.beforeOpening && !d.duplicate).length;
        const dates = drafts.map(d => d.date).sort();
        const sum = type => drafts.filter(d => d.selected && (type === 'in' ? d.type === 'Income' : d.type !== 'Income')).reduce((s, d) => s + d.amount, 0);
        const account = this.accountById(accountId);

        result.innerHTML = `
            <div class="statement-summary">
                <b>${drafts.length} transactions found</b>
                <small>${friendlyDate(dates[0])} – ${friendlyDate(dates[dates.length - 1])} · ${escapeHtml(this.statementFile || '')}</small>
                ${dups ? `<small><i class="fas fa-clone"></i> ${dups} already in MoneyBook (unticked)</small>` : ''}
                ${early ? `<small class="warn-c"><i class="fas fa-triangle-exclamation"></i> ${early} dated before ${escapeHtml(account.name)}'s opening balance (${formatDate(account.openingDate)}), unticked so your balance stays right</small>` : ''}
            </div>
            <div class="statement-tools">
                <button type="button" class="link-btn" id="stAll">Select all</button>
                <button type="button" class="link-btn" id="stNone">Select none</button>
            </div>
            <div class="statement-list">
                ${drafts.map(d => `
                    <label class="statement-row ${d.selected ? '' : 'off'}">
                        <input type="checkbox" data-key="${d.key}" ${d.selected ? 'checked' : ''}>
                        <span class="txn-main">
                            <b>${escapeHtml(displayName(d.note))}</b>
                            <small>${friendlyDate(d.date)} · ${escapeHtml(getCategory(d.category).name)}${d.duplicate ? ' · <span class="warn-c">already added</span>' : d.beforeOpening ? ' · <span class="warn-c">before opening date</span>' : ''}</small>
                        </span>
                        <span class="txn-amt ${d.type === 'Income' ? 'income-c' : d.type === 'Transfer' ? 'transfer-c' : 'expense-c'}">${d.type === 'Income' ? '+' : d.type === 'Transfer' ? '' : '-'}${formatCurrency(d.amount)}</span>
                    </label>`).join('')}
            </div>
            <div class="btn-row sticky-actions">
                <button type="button" class="btn btn-primary grow" id="stImport"></button>
            </div>`;

        const update = () => {
            const n = drafts.filter(d => d.selected).length;
            const btn = result.querySelector('#stImport');
            btn.disabled = !n;
            btn.innerHTML = `<i class="fas fa-file-import"></i> Import ${n} transaction${n === 1 ? '' : 's'} · -${formatCompact(sum('out'))} / +${formatCompact(sum('in'))}`;
        };
        result.querySelectorAll('[data-key]').forEach(cb => cb.addEventListener('change', () => {
            const d = drafts.find(x => x.key === cb.dataset.key);
            d.selected = cb.checked;
            cb.closest('.statement-row').classList.toggle('off', !cb.checked);
            update();
        }));
        const setAll = on => {
            drafts.forEach(d => { d.selected = on; });
            result.querySelectorAll('[data-key]').forEach(cb => { cb.checked = on; cb.closest('.statement-row').classList.toggle('off', !on); });
            update();
        };
        result.querySelector('#stAll').addEventListener('click', () => setAll(true));
        result.querySelector('#stNone').addEventListener('click', () => setAll(false));
        result.querySelector('#stImport').addEventListener('click', async () => {
            const chosen = drafts.filter(d => d.selected);
            chosen.forEach(d => {
                const t = { id: generateId(), type: d.type, amount: d.amount, date: d.date, accountId, category: d.category, paymentMode: d.paymentMode, note: d.note, source: 'statement', refNo: d.refNo || '' };
                if (d.type === 'Transfer') t.toAccountId = d.toAccountId;
                this.data.transactions.push(t);
            });
            this.statementRows = null;
            this.closeSheet();
            await this.persist(`${chosen.length} transaction${chosen.length === 1 ? '' : 's'} imported into ${account.name}`);
        });
        update();
    }

    /* ========== SHARED BANK SMS waiting for review ========== */
    async loadCaptures() {
        if (!Store.data) return;
        const raw = await Native.getCaptures();
        const known = new Set(this.data.transactions.map(t => t.captureId).filter(Boolean));
        this.pendingCaptures = raw.filter(c => !known.has(c.id)).map(c => Capture.toDraft(this.data, c));
        // Merchants you've categorised before (and a matched account) can be saved without asking
        if (this.data.settings.autoSaveKnown) {
            const ready = this.pendingCaptures.filter(c => c.learned && c.accountId);
            if (ready.length) {
                ready.forEach(c => this.data.transactions.push(this.draftToTxn(c)));
                await this.resolveCaptures(ready.map(c => c.captureId), false);
                await Native.takeShared();
                await this.persist(ready.length === 1
                    ? `${formatCurrency(ready[0].amount)} at ${displayName(ready[0].note) || 'merchant'} saved as ${getCategory(ready[0].category).name}`
                    : `${ready.length} shared transactions saved`);
                return;
            }
        }
        await this.checkSharedScan();
        const sharedId = await Native.takeShared();
        const shared = sharedId && this.pendingCaptures.find(c => c.captureId === sharedId);
        if (this.view === 'home') this.render();
        if (shared) this.openTxnSheet(null, 'Expense', shared);
    }

    draftToTxn(c) {
        return {
            id: generateId(), type: c.type, amount: c.amount, date: c.date, time: c.time || '', accountId: c.accountId,
            category: c.category, paymentMode: c.paymentMode, note: c.note, source: c.source, refNo: c.refNo || '',
        };
    }

    async resolveCaptures(ids, rerender = true) {
        await Native.removeCaptures(ids);
        this.pendingCaptures = this.pendingCaptures.filter(c => !ids.includes(c.captureId));
        if (rerender && this.view === 'home') this.render();
    }

    async ignoreCapture(id) {
        await this.resolveCaptures([id]);
        this.toast('Ignored');
    }

    async quickSaveCapture(id) {
        const c = this.pendingCaptures.find(x => x.captureId === id);
        if (!c) return;
        if (!c.category || !c.accountId) { this.openTxnSheet(null, 'Expense', c); return; }
        this.data.transactions.push(this.draftToTxn(c));
        Capture.learn(this.data, c.note, c.category);
        await this.resolveCaptures([id], false);
        await this.persist(`${c.type} of ${formatCurrency(c.amount)} saved`);
    }

    capturesCard() {
        const list = this.pendingCaptures;
        if (!list.length) return '';
        return `
            <div class="card capture-card">
                <div class="card-header">
                    <h3><i class="fas fa-share-nodes"></i> ${list.length} shared transaction${list.length === 1 ? '' : 's'} to review</h3>
                </div>
                ${list.slice(0, 5).map(c => {
                    const acc = c.accountId ? this.accountName(c.accountId) : (c.last4 ? `••${c.last4} (unknown)` : 'Pick account');
                    const cat = c.category ? getCategory(c.category).name : 'Pick category';
                    const ready = c.category && c.accountId;
                    return `
                    <div class="capture-row">
                        <button class="rec-info" data-action="review-capture" data-id="${escapeHtml(c.captureId)}">
                            <span class="txn-icon ${c.type.toLowerCase()}"><i class="${c.category ? getCategory(c.category).icon : 'fas fa-question'}"></i></span>
                            <span class="txn-main">
                                <b>${escapeHtml(displayName(c.note) || (c.type === 'Income' ? 'Money received' : 'Payment'))}</b>
                                <small>${escapeHtml(cat)} · ${escapeHtml(acc)} · ${formatDate(c.date)}</small>
                            </span>
                            <span class="txn-amt ${c.type === 'Income' ? 'income-c' : 'expense-c'}">${c.type === 'Income' ? '+' : '-'}${formatCurrency(c.amount)}</span>
                        </button>
                        <div class="capture-actions">
                            <button class="chip-btn" data-action="${ready ? 'save-capture' : 'review-capture'}" data-id="${escapeHtml(c.captureId)}"><i class="fas ${ready ? 'fa-check' : 'fa-pen'}"></i> ${ready ? 'Save' : 'Review'}</button>
                            <button class="icon-btn sm" data-action="ignore-capture" data-id="${escapeHtml(c.captureId)}" aria-label="Ignore"><i class="fas fa-xmark"></i></button>
                        </div>
                    </div>`;
                }).join('')}
                ${list.length > 5 ? `<p class="hint">+ ${list.length - 5} more after these</p>` : ''}
            </div>`;
    }

    /* ========== AUTOMATION SETTINGS ========== */
    bindSettingToggles(viewId) {
        document.querySelectorAll(`#${viewId} [data-setting]`).forEach(input => input.addEventListener('change', async () => {
            const key = input.dataset.setting;
            this.data.settings[key] = input.type === 'checkbox' ? input.checked : input.value;
            if (key === 'lockOnOpen') this.resetIdleTimer();
            await this.persist('Saved');
        }));
    }

    async renderAutomation() {
        const s = this.data.settings;
        const status = await Native.status();
        const el = document.getElementById('view-automation');
        const toggle = (key, icon, title, sub, extra = '') => `
            <label class="menu-item toggle-row"><span class="menu-icon"><i class="${icon}"></i></span><span class="menu-text"><b>${title}</b><small>${sub}</small>${extra}</span><input type="checkbox" class="switch" data-setting="${key}" ${s[key] ? 'checked' : ''}></label>`;
        const statusRow = (on, icon, title, sub, action, label) => `
            <div class="menu-item"><span class="menu-icon"><i class="${icon}"></i></span><span class="menu-text"><b>${title}</b><small>${sub}</small></span>
            ${on ? '<span class="badge good"><i class="fas fa-check"></i> On</span>' : `<button class="chip-btn" data-action="${action}">${label}</button>`}</div>`;
        const noLast4 = this.data.accounts.filter(a => !a.archived && !a.last4).length;
        const family = APP_CONFIG.apiUrl ? '' : `
            <div class="card flush menu">
                <div class="card-header padded"><h3>Family</h3></div>
                <button class="menu-item" data-action="copy-share-link"><span class="menu-icon"><i class="fas fa-link"></i></span><span class="menu-text"><b>${Native.isNative ? 'Copy Google Sheet link' : 'Copy family invite link'}</b><small>${Native.isNative ? 'Family members paste it on the Connect screen, then create their own login' : 'Opens MoneyBook already connected to your Google Sheet'}</small></span></button>
            </div>`;

        el.innerHTML = Native.isNative ? `
            <div class="card">
                <h3><i class="fas fa-paste"></i> Add a bank SMS in seconds</h3>
                <ol class="steps">
                    <li>In your SMS app, long-press a debit or credit SMS from your bank → <b>Copy</b></li>
                    <li>Open MoneyBook and tap <b>Paste SMS</b> on Home</li>
                    <li>Amount, account, merchant, date and category are filled in. Tap <b>Save</b></li>
                </ol>
                <p class="hint">You can also <b>share a screenshot</b> of a bank SMS or a GPay / PhonePe payment screen to MoneyBook, or share the SMS itself if your SMS app allows it.</p>
                <p class="hint"><i class="fas fa-shield-halved"></i> MoneyBook has no permission to read your SMS or notifications. It only sees the message you share, OTPs are refused, and the message text is never saved.</p>
            </div>
            <div class="card flush menu">
                ${toggle('autoSaveKnown', 'fas fa-bolt', 'Save known merchants instantly', 'When you share an SMS from a merchant you\'ve categorised before, save it without the review step')}
            </div>
            ${noLast4 ? `<div class="card tint-warn"><div class="overall"><i class="fas fa-circle-info"></i><div><b>Add last 4 digits to ${noLast4} account${noLast4 === 1 ? '' : 's'}</b><small>So detected SMS land in the right account. <button class="link-btn" data-action="go" data-view="accounts">Open accounts →</button></small></div></div></div>` : ''}
            <div class="card flush menu">
                <div class="card-header padded"><h3>Reminders</h3></div>
                ${statusRow(status.notifications, 'fas fa-bell', 'Notifications', 'Needed for reminders and detected-transaction alerts', 'enable-notifications', 'Allow')}
                ${toggle('dailyReminder', 'fas fa-clock', 'Daily reminder', 'Nudge to log cash spends', `<input type="time" class="time-input" data-setting="reminderTime" value="${escapeHtml(s.reminderTime || '21:00')}">`)}
                ${toggle('dueReminders', 'fas fa-calendar-day', 'Auto-debit reminders', 'The day before each SIP, EMI, rent or subscription')}
                ${toggle('budgetAlerts', 'fas fa-chart-simple', 'Budget alerts', 'When a category reaches 80% and 100% of its budget')}
                <button class="menu-item" data-action="test-notification"><span class="menu-icon"><i class="fas fa-paper-plane"></i></span><span class="menu-text"><b>Send a test notification</b></span></button>
            </div>
            ${family}` : `
            <div class="card">
                <h3><i class="fas fa-mobile-screen"></i> Get the Android app</h3>
                <p class="hint">Adding bank SMS with Share → MoneyBook, and reminder notifications, work in the MoneyBook Android app. Download the APK from the <a href="https://github.com/harshhaldankar/moneybook/releases/latest" target="_blank" rel="noopener">latest release</a>, then log in with the same User ID. Your data syncs through the Google Sheet.</p>
            </div>
            ${family}`;
        this.bindSettingToggles('view-automation');
    }

    async copyShareLink() {
        const link = Native.isNative ? Api.url : `${location.origin}${location.pathname}?api=${encodeURIComponent(Api.url)}`;
        try {
            await navigator.clipboard.writeText(link);
            this.toast('Link copied', 'success');
        } catch {
            this.openSheet('Share link', `<div class="sheet-form"><p class="hint">Copy this link:</p><input type="text" value="${escapeHtml(link)}" readonly onfocus="this.select()"></div>`);
        }
    }

    targetBlock(s) {
        if (!s.target) {
            return `<button class="target-empty" data-action="edit-target"><i class="fas fa-bullseye"></i> Set a monthly savings target</button>`;
        }
        const pct = Math.max(0, Math.min(s.targetPct ?? 0, 100));
        const hit = s.saved >= s.target;
        const status = hit
            ? `<span class="badge good"><i class="fas fa-check"></i> Target reached</span>`
            : `<span class="badge warn"><i class="fas fa-hourglass-half"></i> ${formatCurrency(s.target - s.saved)} to go</span>`;
        return `
            <div class="target-block" data-action="edit-target">
                <div class="target-head">
                    <span>Savings target <b>${formatCurrency(s.target)}</b></span>
                    ${status}
                </div>
                <div class="progress"><div class="progress-fill ${hit ? 'good' : ''}" style="width:${pct}%"></div></div>
                <small>${s.targetPct ?? 0}% of target${s.savingsRate !== null ? ` · saving ${s.savingsRate}% of income` : ''}</small>
            </div>`;
    }

    budgetAlerts() {
        const month = this.month;
        const spend = Object.fromEntries(Calc.categorySpend(this.data, month).map(c => [c.category, c.amount]));
        const alerts = this.data.budgets
            .filter(b => b.month === month && (spend[b.category] || 0) >= b.amount * 0.8)
            .map(b => ({ ...b, spent: spend[b.category] || 0 }));
        if (!alerts.length) return '';
        return `
            <div class="card">
                <div class="card-header"><h3>Budget alerts</h3><button class="link-btn" data-action="go" data-view="budgets">Budgets →</button></div>
                ${alerts.map(b => `
                    <div class="alert-row ${b.spent > b.amount ? 'over' : ''}">
                        <i class="${getCategory(b.category).icon}"></i>
                        <span>${escapeHtml(getCategory(b.category).name)}</span>
                        <b>${b.spent > b.amount ? `Over by ${formatCurrency(b.spent - b.amount)}` : `${Math.round(b.spent / b.amount * 100)}% used`}</b>
                    </div>`).join('')}
            </div>`;
    }

    /* ========== TRANSACTION LIST ========== */
    txnListHtml(txns, groupByDate = true) {
        if (!txns.length) return `<div class="empty-state"><div class="empty-icon"><i class="fas fa-receipt"></i></div><p>No transactions yet</p><small>Tap <b>+</b> to add one, or share a bank SMS to MoneyBook</small></div>`;
        let lastDate = null;
        return `<div class="txn-list">${txns.map(t => {
            const cat = getCategory(t.category);
            const header = groupByDate && t.date !== lastDate ? `<div class="date-header">${friendlyDate(t.date)}</div>` : '';
            lastDate = t.date;
            const isTransfer = t.type === 'Transfer';
            const sub = isTransfer
                ? `${escapeHtml(this.accountName(t.accountId))} → ${escapeHtml(this.accountName(t.toAccountId))}`
                : `${escapeHtml(this.accountName(t.accountId))}${t.paymentMode ? ' · ' + escapeHtml(t.paymentMode) : ''}${groupByDate ? '' : ' · ' + friendlyDate(t.date)}${t.time ? ' · ' + new Date(`2000-01-01T${t.time}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''}`;
            const amtClass = isTransfer ? 'transfer-c' : t.type === 'Income' ? 'income-c' : 'expense-c';
            const sign = isTransfer ? '' : t.type === 'Income' ? '+' : '-';
            return `${header}
                <button class="txn-row" data-action="edit-txn" data-id="${t.id}">
                    <span class="txn-icon ${t.type.toLowerCase()}"><i class="${cat.icon}"></i></span>
                    <span class="txn-main">
                        <b>${escapeHtml(displayName(t.note) || cat.name)}</b>
                        <small>${t.note ? escapeHtml(cat.name) + ' · ' : ''}${sub}</small>
                    </span>
                    <span class="txn-amt ${amtClass}">${sign}${formatCurrency(t.amount)}</span>
                </button>`;
        }).join('')}</div>`;
    }

    /* ========== ACTIVITY ========== */
    renderActivity() {
        const d = this.data;
        const f = this.filters;
        const el = document.getElementById('view-activity');
        const search = f.search.toLowerCase();
        const txns = Calc.monthTxns(d, this.month)
            .filter(t => f.account === 'all' || t.accountId === f.account || t.toAccountId === f.account)
            .filter(t => f.type === 'all' || t.type === f.type)
            .filter(t => !search || `${t.note} ${getCategory(t.category).name} ${t.paymentMode} ${t.amount}`.toLowerCase().includes(search))
            .sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '') || b.id.localeCompare(a.id));

        const inSum = txns.filter(t => t.type === 'Income').reduce((s, t) => s + Number(t.amount), 0);
        const outSum = txns.filter(t => t.type === 'Expense').reduce((s, t) => s + Number(t.amount), 0);

        el.innerHTML = `
            ${this.monthSwitcher()}
            <div class="filter-bar">
                <div class="search-box"><i class="fas fa-magnifying-glass"></i><input type="search" id="actSearch" placeholder="Search" value="${escapeHtml(f.search)}"></div>
                <div class="chip-scroll">
                    <button class="filter-chip ${f.account === 'all' ? 'active' : ''}" data-filter-account="all">All accounts</button>
                    ${d.accounts.map(a => `<button class="filter-chip ${f.account === a.id ? 'active' : ''}" data-filter-account="${a.id}"><span class="dot" style="background:${a.color}"></span>${escapeHtml(a.name)}</button>`).join('')}
                </div>
                <div class="segmented">
                    ${['all', 'Expense', 'Income', 'Transfer'].map(t => `<button class="${f.type === t ? 'active' : ''}" data-filter-type="${t}">${t === 'all' ? 'All' : t}</button>`).join('')}
                </div>
            </div>
            <div class="summary-strip">
                <span>${txns.length} transaction${txns.length === 1 ? '' : 's'}</span>
                <span>In <b class="income-c">${formatCurrency(inSum)}</b></span>
                <span>Out <b class="expense-c">${formatCurrency(outSum)}</b></span>
            </div>
            <div class="card flush">${this.txnListHtml(txns)}</div>`;

        const searchInput = el.querySelector('#actSearch');
        searchInput.addEventListener('input', () => {
            f.search = searchInput.value;
            const pos = searchInput.selectionStart;
            this.renderActivity();
            const again = document.getElementById('actSearch');
            again.focus();
            again.setSelectionRange(pos, pos);
        });
        el.querySelectorAll('[data-filter-account]').forEach(b => b.addEventListener('click', () => { f.account = b.dataset.filterAccount; this.renderActivity(); }));
        el.querySelectorAll('[data-filter-type]').forEach(b => b.addEventListener('click', () => { f.type = b.dataset.filterType; this.renderActivity(); }));
    }

    /* ========== SAVINGS ========== */
    renderSavings() {
        const d = this.data;
        const el = document.getElementById('view-savings');
        const s = Calc.monthStats(d, this.month);
        const history = Calc.savingsHistory(d, this.month, 12);
        const cumulative = history.length ? history[history.length - 1].cumulativeVsTarget : 0;
        const anyTarget = history.some(r => r.target > 0);
        const newAccountsAdj = s.closingBalance - (s.openingBalance + s.income - s.spent - s.invested);

        el.innerHTML = `
            ${this.monthSwitcher()}

            <div class="card">
                <div class="card-header"><h3>Savings</h3><button class="link-btn" data-action="edit-target"><i class="fas fa-pen"></i> Target</button></div>
                <div class="big-number">
                    <span>Saved this month</span>
                    <b class="${s.saved < 0 ? 'expense-c' : ''}">${formatCurrency(s.saved)}</b>
                </div>
                ${this.targetBlock(s)}
            </div>

            <div class="card">
                <h3>Carry forward</h3>
                <div class="flow">
                    <div class="flow-row"><span>Carried in from ${monthLabel(shiftMonth(this.month, -1), true)}</span><b>${formatCurrency(s.openingBalance)}</b></div>
                    <div class="flow-row"><span><i class="fas fa-plus income-c"></i> Income</span><b class="income-c">${formatCurrency(s.income)}</b></div>
                    <div class="flow-row"><span><i class="fas fa-minus expense-c"></i> Expenses</span><b class="expense-c">${formatCurrency(s.spent)}</b></div>
                    ${s.invested ? `<div class="flow-row"><span><i class="fas fa-minus"></i> Invested (SIP etc.)</span><b>${formatCurrency(s.invested)}</b></div>` : ''}
                    ${Math.abs(newAccountsAdj) > 0.005 ? `<div class="flow-row"><span><i class="fas fa-plus"></i> New account opening balances</span><b>${formatCurrency(newAccountsAdj)}</b></div>` : ''}
                    <div class="flow-row total"><span>Carry forward to ${monthLabel(shiftMonth(this.month, 1), true)}</span><b>${formatCurrency(s.closingBalance)}</b></div>
                </div>
                <p class="hint">Transfers between your own accounts don't change these totals.${d.settings.investmentsCountAsSavings ? ' Investments count as saved money.' : ''}</p>
            </div>

            ${anyTarget ? `
            <div class="card ${cumulative >= 0 ? 'tint-good' : 'tint-warn'}">
                <div class="overall">
                    <i class="fas ${cumulative >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
                    <div>
                        <b>${cumulative >= 0 ? `${formatCurrency(cumulative)} ahead of target` : `${formatCurrency(-cumulative)} behind target`}</b>
                        <small>Running total over the last ${history.length} month${history.length === 1 ? '' : 's'} (${monthLabel(history[0].monthKey, true)} – ${monthLabel(this.month, true)})</small>
                    </div>
                </div>
            </div>` : ''}

            <div class="card chart-card">
                <h3>Saved per month</h3>
                <div class="legend">
                    <span><i class="swatch" style="background:var(--series-1)"></i>Saved</span>
                    ${anyTarget ? '<span><i class="swatch line"></i>Target</span>' : ''}
                </div>
                <div class="chart-box"><canvas id="savingsChart" aria-label="Bar chart of money saved per month"></canvas></div>
            </div>

            <div class="card flush">
                <div class="card-header padded"><h3>Month on Month</h3></div>
                <div class="table-wrap">
                    <table class="mom-table">
                        <thead><tr><th>Month</th><th>Income</th><th>Spent</th><th>Saved</th><th>Target</th><th>vs Target</th><th>Carry fwd</th></tr></thead>
                        <tbody>
                            ${[...history].reverse().map(r => `
                            <tr class="${r.monthKey === this.month ? 'current' : ''}" data-action="month-set" data-month="${r.monthKey}">
                                <td>${monthLabel(r.monthKey, true)}</td>
                                <td>${formatCompact(r.income)}</td>
                                <td>${formatCompact(r.spent)}</td>
                                <td><b>${formatCompact(r.saved)}</b></td>
                                <td>${r.target ? formatCompact(r.target) : '–'}</td>
                                <td class="${r.target ? (r.vsTarget >= 0 ? 'income-c' : 'expense-c') : ''}">${r.target ? (r.vsTarget >= 0 ? '+' : '') + formatCompact(r.vsTarget) : '–'}</td>
                                <td>${formatCompact(r.closingBalance)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;

        this.renderSavingsChart(history);
    }

    cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    destroyCharts() {
        Object.values(this.charts).forEach(c => c.destroy());
        this.charts = {};
    }

    chartDefaults() {
        Chart.defaults.font.family = "'Geist', system-ui, sans-serif";
        const tick = { family: "'Geist Mono', ui-monospace, monospace", size: 11 };
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: this.cssVar('--text-muted'), font: tick }, border: { color: this.cssVar('--border') } },
                y: { grid: { color: this.cssVar('--grid') }, border: { display: false }, ticks: { color: this.cssVar('--text-muted'), font: tick, callback: v => formatCompact(v) } },
            },
        };
    }

    renderSavingsChart(history) {
        if (typeof Chart === 'undefined') return;
        this.charts.savings?.destroy();
        const anyTarget = history.some(r => r.target > 0);
        const ctx = document.getElementById('savingsChart');
        this.charts.savings = new Chart(ctx, {
            data: {
                labels: history.map(r => monthLabel(r.monthKey, true)),
                datasets: [
                    {
                        type: 'bar', label: 'Saved', data: history.map(r => r.saved),
                        backgroundColor: history.map(r => r.monthKey === this.month ? this.cssVar('--series-1') : this.cssVar('--series-1-soft')),
                        borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28,
                    },
                    ...(anyTarget ? [{
                        type: 'line', label: 'Target', data: history.map(r => r.target),
                        borderColor: this.cssVar('--text-secondary'), borderWidth: 2, borderDash: [5, 4],
                        pointRadius: 0, pointHoverRadius: 4, stepped: 'middle', fill: false,
                    }] : []),
                ],
            },
            options: {
                ...this.chartDefaults(),
                onClick: (_, els) => { if (els.length) { this.month = history[els[0].index].monthKey; this.render(); } },
            },
        });
    }

    /* ========== MORE MENU ========== */
    renderMore() {
        const d = this.data;
        const item = (view, icon, title, sub) => `
            <button class="menu-item" data-action="go" data-view="${view}">
                <span class="menu-icon"><i class="${icon}"></i></span>
                <span class="menu-text"><b>${title}</b><small>${sub}</small></span>
                <i class="fas fa-chevron-right"></i>
            </button>`;
        document.getElementById('view-more').innerHTML = `
            <div class="card profile-card" data-action="go" data-view="profile">
                <span class="avatar lg">${escapeHtml(this.initials(d.profile.displayName))}</span>
                <div><b>${escapeHtml(d.profile.displayName)}</b><small>@${escapeHtml(Store.userId)}</small></div>
                <i class="fas fa-chevron-right"></i>
            </div>
            <div class="card flush menu">
                ${item('automation', 'fas fa-share-nodes', 'Share SMS & Reminders', Native.isNative ? 'Share bank SMS, reminders' : 'Reminders and setup for the Android app')}
                <button class="menu-item" data-action="import-statement"><span class="menu-icon"><i class="fas fa-file-import"></i></span><span class="menu-text"><b>Import bank statement</b><small>Excel or CSV from net banking</small></span><i class="fas fa-chevron-right"></i></button>
                ${item('accounts', 'fas fa-building-columns', 'Bank accounts', `${this.activeAccounts().length} active · add, edit, set main`)}
                ${item('budgets', 'fas fa-chart-simple', 'Budgets', 'Monthly limits per category')}
                ${item('recurring', 'fas fa-repeat', 'Auto-Debits', 'SIPs, EMIs, rent, subscriptions')}
                ${item('reports', 'fas fa-chart-pie', 'Reports', 'Where your money goes')}
                ${item('profile', 'fas fa-user-shield', 'Profile & Security', 'Password, backup, export')}
            </div>
            <div class="card flush menu">
                <button class="menu-item" data-action="lock"><span class="menu-icon"><i class="fas fa-lock"></i></span><span class="menu-text"><b>Lock app</b><small>Auto-locks after 10 minutes idle</small></span></button>
                <button class="menu-item danger" data-action="logout"><span class="menu-icon"><i class="fas fa-right-from-bracket"></i></span><span class="menu-text"><b>Log out</b><small>Switch to another user</small></span></button>
            </div>`;
    }

    /* ========== ACCOUNTS ========== */
    renderAccounts() {
        const d = this.data;
        const split = Calc.balanceSplit(d);
        const row = a => `
            <button class="account-row ${a.archived ? 'archived' : ''}" data-action="edit-account" data-id="${a.id}">
                <span class="acc-avatar" style="--acc:${a.color}"><i class="fas ${a.type === 'Cash / Wallet' ? 'fa-wallet' : a.type === 'Credit Card' ? 'fa-credit-card' : 'fa-building-columns'}"></i></span>
                <span class="txn-main">
                    <b>${escapeHtml(a.name)} ${a.isMain ? '<span class="badge main">Main</span>' : ''}${a.archived ? '<span class="badge">Archived</span>' : ''}</b>
                    <small>${escapeHtml([a.bank, a.type].filter(Boolean).join(' · '))}</small>
                </span>
                <span class="txn-amt">${formatCurrency(Calc.accountBalance(d, a))}</span>
            </button>`;
        document.getElementById('view-accounts').innerHTML = `
            <div class="card hero-card compact">
                <span class="hero-label">Total across all accounts</span>
                <span class="hero-value">${formatCurrency(split.total)}</span>
                <div class="hero-split">
                    <div><span class="hero-sub">Main</span><b>${formatCurrency(split.mainBal)}</b></div>
                    <div><span class="hero-sub">Others</span><b>${formatCurrency(split.othersBal)}</b></div>
                </div>
            </div>
            <div class="card flush">
                ${d.accounts.length ? `<div class="txn-list">${d.accounts.filter(a => !a.archived).map(row).join('')}${d.accounts.filter(a => a.archived).map(row).join('')}</div>`
                    : `<div class="empty-state"><i class="fas fa-building-columns"></i><p>No accounts yet</p></div>`}
            </div>
            <button class="btn btn-primary btn-block" data-action="add-account"><i class="fas fa-plus"></i> Add Bank Account</button>
            <p class="hint center">Tap an account to edit it, rename it, or make it your Main account.</p>`;
    }

    /* ========== BUDGETS ========== */
    renderBudgets() {
        const d = this.data;
        const spend = Object.fromEntries(Calc.categorySpend(d, this.month).map(c => [c.category, c.amount]));
        const budgets = d.budgets.filter(b => b.month === this.month);
        const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
        const totalSpent = budgets.reduce((s, b) => s + (spend[b.category] || 0), 0);
        const hasLastMonth = d.budgets.some(b => b.month === shiftMonth(this.month, -1));

        document.getElementById('view-budgets').innerHTML = `
            ${this.monthSwitcher()}
            ${budgets.length ? `
            <div class="card">
                <div class="stat-row">
                    <div class="stat"><span>Budgeted</span><b>${formatCurrency(totalBudget)}</b></div>
                    <div class="stat"><span>Spent</span><b class="expense-c">${formatCurrency(totalSpent)}</b></div>
                    <div class="stat"><span>Left</span><b class="${totalBudget - totalSpent < 0 ? 'expense-c' : 'income-c'}">${formatCurrency(totalBudget - totalSpent)}</b></div>
                </div>
            </div>
            <div class="card flush">
                ${budgets.map(b => {
                    const spent = spend[b.category] || 0;
                    const pct = Math.round(spent / b.amount * 100);
                    const cat = getCategory(b.category);
                    return `
                    <button class="budget-row" data-action="edit-budget" data-id="${b.id}">
                        <div class="budget-top">
                            <span><i class="${cat.icon}"></i> ${escapeHtml(cat.name)}</span>
                            <span>${formatCurrency(spent)} <small>of ${formatCurrency(b.amount)}</small></span>
                        </div>
                        <div class="progress"><div class="progress-fill ${pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'good'}" style="width:${Math.min(pct, 100)}%"></div></div>
                        <small class="${pct > 100 ? 'expense-c' : ''}">${pct > 100 ? `<i class="fas fa-triangle-exclamation"></i> Over by ${formatCurrency(spent - b.amount)}` : `${formatCurrency(b.amount - spent)} left · ${pct}% used`}</small>
                    </button>`;
                }).join('')}
            </div>` : `<div class="card empty-state"><i class="fas fa-chart-simple"></i><p>No budgets for ${monthLabel(this.month)}</p></div>`}
            <div class="btn-row">
                <button class="btn btn-primary" data-action="add-budget"><i class="fas fa-plus"></i> Add Budget</button>
                ${hasLastMonth ? `<button class="btn btn-secondary" data-action="copy-budgets"><i class="fas fa-copy"></i> Copy last month</button>` : ''}
            </div>`;
    }

    async copyLastMonthBudgets() {
        const prev = shiftMonth(this.month, -1);
        const existing = new Set(this.data.budgets.filter(b => b.month === this.month).map(b => b.category));
        const copies = this.data.budgets.filter(b => b.month === prev && !existing.has(b.category))
            .map(b => ({ ...b, id: generateId(), month: this.month }));
        this.data.budgets.push(...copies);
        await this.persist(`${copies.length} budget${copies.length === 1 ? '' : 's'} copied`);
    }

    /* ========== RECURRING ========== */
    recurringStep(freq) { return freq === 'Quarterly' ? 3 : freq === 'Yearly' ? 12 : 1; }

    monthDiff(a, b) {
        const [ay, am] = a.split('-').map(Number);
        const [by, bm] = b.split('-').map(Number);
        return (by - ay) * 12 + (bm - am);
    }

    /** The next unpaid due date for a recurring item (may be in the past = overdue). */
    nextDue(r) {
        const step = this.recurringStep(r.frequency);
        const start = r.startMonth || currentMonthKey();
        let m = r.lastPaidMonth ? shiftMonth(r.lastPaidMonth, step) : start;
        while (this.monthDiff(start, m) % step !== 0) m = shiftMonth(m, 1);
        const lastDay = Number(lastDayOfMonth(m).slice(8));
        return `${m}-${String(Math.min(r.debitDay, lastDay)).padStart(2, '0')}`;
    }

    upcomingRecurringCard() {
        const horizon = new Date(); horizon.setDate(horizon.getDate() + 10);
        const h = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;
        const items = this.data.recurring.filter(r => r.isActive).map(r => ({ ...r, due: this.nextDue(r) }))
            .filter(r => r.due <= h).sort((a, b) => a.due.localeCompare(b.due));
        if (!items.length) return '';
        return `
            <div class="card">
                <div class="card-header"><h3>Upcoming auto-debits</h3><button class="link-btn" data-action="go" data-view="recurring">All →</button></div>
                ${items.map(r => this.recurringRowHtml(r)).join('')}
            </div>`;
    }

    recurringRowHtml(r) {
        const due = r.due || this.nextDue(r);
        const overdue = r.isActive && due < todayStr();
        return `
            <div class="rec-row ${r.isActive ? '' : 'paused'}">
                <button class="rec-info" data-action="edit-recurring" data-id="${r.id}">
                    <span class="txn-icon expense"><i class="${getCategory(r.category).icon}"></i></span>
                    <span class="txn-main">
                        <b>${escapeHtml(r.name)}</b>
                        <small>${formatCurrency(r.amount)} · ${escapeHtml(this.accountName(r.accountId))} · ${r.isActive ? `${overdue ? '<span class="expense-c">Due</span>' : 'Next'} ${formatDate(due)}` : 'Paused'}</small>
                    </span>
                </button>
                ${!r.isActive ? '' : r.autoPost ? `<span class="badge main" title="Recorded automatically on the debit day"><i class="fas fa-robot"></i> Auto</span>` : `<button class="chip-btn" data-action="pay-recurring" data-id="${r.id}"><i class="fas fa-check"></i> Paid</button>`}
            </div>`;
    }

    renderRecurring() {
        const list = [...this.data.recurring].sort((a, b) => (b.isActive - a.isActive) || this.nextDue(a).localeCompare(this.nextDue(b)));
        const monthlyTotal = this.data.recurring.filter(r => r.isActive).reduce((s, r) => s + r.amount / this.recurringStep(r.frequency), 0);
        document.getElementById('view-recurring').innerHTML = `
            <div class="card">
                <div class="stat-row">
                    <div class="stat"><span>Active items</span><b>${this.data.recurring.filter(r => r.isActive).length}</b></div>
                    <div class="stat"><span>Avg. per month</span><b class="expense-c">${formatCurrency(Math.round(monthlyTotal))}</b></div>
                </div>
            </div>
            <div class="card flush">
                ${list.length ? list.map(r => this.recurringRowHtml(r)).join('') : `<div class="empty-state"><i class="fas fa-repeat"></i><p>No auto-debits yet</p></div>`}
            </div>
            <button class="btn btn-primary btn-block" data-action="add-recurring"><i class="fas fa-plus"></i> Add Auto-Debit</button>
            <p class="hint center"><b>Auto</b> items are recorded by the Google Sheet on their debit day. For the others, tap <b>Paid</b> when it's debited.</p>`;
    }

    async payRecurring(id) {
        const r = this.data.recurring.find(x => x.id === id);
        if (!r) return;
        if (!this.accountById(r.accountId)) { this.toast('Pick an account for this auto-debit first', 'error'); this.openRecurringSheet(r); return; }
        const due = this.nextDue(r);
        this.data.transactions.push({
            id: generateId(), type: 'Expense', amount: r.amount, date: due > todayStr() ? todayStr() : due,
            accountId: r.accountId, category: r.category, paymentMode: 'Auto-Debit', note: r.name,
        });
        r.lastPaidMonth = monthKeyOf(due);
        await this.persist(`${r.name} recorded as paid`);
    }

    /* ========== REPORTS ========== */
    renderReports() {
        const d = this.data;
        const cats = Calc.categorySpend(d, this.month);
        const total = cats.reduce((s, c) => s + c.amount, 0);
        const monthTx = Calc.monthTxns(d, this.month).filter(t => t.type === 'Expense');
        const byAccount = {}; const byMode = {};
        monthTx.forEach(t => {
            byAccount[t.accountId] = (byAccount[t.accountId] || 0) + Number(t.amount);
            byMode[t.paymentMode || 'Other'] = (byMode[t.paymentMode || 'Other'] || 0) + Number(t.amount);
        });
        const bars = (rows) => rows.length ? rows.map(r => `
            <div class="hbar">
                <div class="hbar-label"><span>${r.icon ? `<i class="${r.icon}"></i> ` : ''}${escapeHtml(r.label)}</span><span>${formatCurrency(r.amount)} <small>${total ? Math.round(r.amount / total * 100) : 0}%</small></span></div>
                <div class="hbar-track"><div class="hbar-fill" style="width:${rows[0].amount ? (r.amount / rows[0].amount * 100) : 0}%"></div></div>
            </div>`).join('') : `<div class="empty-state"><i class="fas fa-chart-pie"></i><p>No expenses this month</p></div>`;
        const top = [...monthTx].sort((a, b) => b.amount - a.amount).slice(0, 5);

        document.getElementById('view-reports').innerHTML = `
            ${this.monthSwitcher()}
            <div class="card">
                <div class="card-header"><h3>Spending by Category</h3><b>${formatCurrency(total)}</b></div>
                ${bars(cats.map(c => ({ label: getCategory(c.category).name, icon: getCategory(c.category).icon, amount: c.amount })))}
            </div>
            <div class="card chart-card">
                <h3>Income vs Expenses · last 6 months</h3>
                <div class="legend">
                    <span><i class="swatch" style="background:var(--series-1)"></i>Income</span>
                    <span><i class="swatch" style="background:var(--series-2)"></i>Expenses</span>
                </div>
                <div class="chart-box"><canvas id="incomeExpenseChart" aria-label="Income versus expenses for the last 6 months"></canvas></div>
            </div>
            <div class="card">
                <h3>Spending by Account</h3>
                ${bars(Object.entries(byAccount).map(([id, amount]) => ({ label: this.accountName(id), amount })).sort((a, b) => b.amount - a.amount))}
            </div>
            <div class="card">
                <h3>Spending by Payment Mode</h3>
                ${bars(Object.entries(byMode).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount))}
            </div>
            <div class="card">
                <h3>Top 5 Expenses</h3>
                ${this.txnListHtml(top, false)}
            </div>`;

        if (typeof Chart === 'undefined') return;
        this.charts.incomeExpense?.destroy();
        const months = Array.from({ length: 6 }, (_, i) => shiftMonth(this.month, i - 5));
        const stats = months.map(m => Calc.monthStats(d, m));
        this.charts.incomeExpense = new Chart(document.getElementById('incomeExpenseChart'), {
            type: 'bar',
            data: {
                labels: months.map(m => monthLabel(m, true)),
                datasets: [
                    { label: 'Income', data: stats.map(s => s.income), backgroundColor: this.cssVar('--series-1'), borderRadius: 3, maxBarThickness: 20 },
                    { label: 'Expenses', data: stats.map(s => s.spent + s.invested), backgroundColor: this.cssVar('--series-2'), borderRadius: 3, maxBarThickness: 20 },
                ],
            },
            options: this.chartDefaults(),
        });
    }

    /* ========== PROFILE ========== */
    renderProfile() {
        const d = this.data;
        document.getElementById('view-profile').innerHTML = `
            <div class="card profile-card">
                <span class="avatar lg">${escapeHtml(this.initials(d.profile.displayName))}</span>
                <div><b>${escapeHtml(d.profile.displayName)}</b><small>User ID: @${escapeHtml(Store.userId)}</small></div>
            </div>
            <div class="card flush menu">
                <button class="menu-item" data-action="edit-name"><span class="menu-icon"><i class="fas fa-id-card"></i></span><span class="menu-text"><b>Change display name</b></span><i class="fas fa-chevron-right"></i></button>
                <button class="menu-item" data-action="change-password"><span class="menu-icon"><i class="fas fa-key"></i></span><span class="menu-text"><b>Change password</b><small>Logs you out on other devices</small></span><i class="fas fa-chevron-right"></i></button>
                <label class="menu-item toggle-row"><span class="menu-icon"><i class="fas fa-lock"></i></span><span class="menu-text"><b>Lock when opening</b><small>Also locks after 10 minutes idle</small></span><input type="checkbox" class="switch" data-setting="lockOnOpen" ${d.settings.lockOnOpen !== false ? 'checked' : ''}></label>
                <label class="menu-item toggle-row" id="bioRow" hidden><span class="menu-icon"><i class="fas fa-fingerprint"></i></span><span class="menu-text"><b id="bioTitle">Unlock with fingerprint</b><small>On this phone only. Your password still works.</small></span><input type="checkbox" class="switch" id="bioToggle" ${Native.bioEnabled(Store.userId) ? 'checked' : ''}></label>
            </div>
            <div class="card flush menu">
                <button class="menu-item" data-action="export"><span class="menu-icon"><i class="fas fa-download"></i></span><span class="menu-text"><b>Download backup (JSON)</b><small>Restore it on any device</small></span></button>
                <button class="menu-item" data-action="export-csv"><span class="menu-icon"><i class="fas fa-file-csv"></i></span><span class="menu-text"><b>Export transactions (CSV)</b><small>Open in Excel / Google Sheets</small></span></button>
                <button class="menu-item" data-action="import"><span class="menu-icon"><i class="fas fa-upload"></i></span><span class="menu-text"><b>Restore from backup</b><small>Replaces your current data</small></span></button>
                <input type="file" id="importFile" accept=".json,application/json" hidden>
            </div>
            <div class="card flush menu">
                <button class="menu-item danger" data-action="delete-profile"><span class="menu-icon"><i class="fas fa-user-xmark"></i></span><span class="menu-text"><b>Remove from this device</b><small>Your data stays safe in the Google Sheet</small></span></button>
            </div>
            ${Native.isNative ? `
            <div class="card flush menu">
                <button class="menu-item" data-action="check-update"><span class="menu-icon"><i class="fas fa-rotate"></i></span><span class="menu-text"><b>Check for updates</b><small>MoneyBook ${escapeHtml(this.appVersion || '')}${this.update ? ` · v${escapeHtml(this.update.version)} available` : ''}</small></span>${this.update ? '<span class="badge main">New</span>' : ''}</button>
            </div>` : ''}
            <p class="hint center"><i class="fas fa-shield-halved"></i> Your data is backed up online and cached on this device for offline use.</p>`;
        document.getElementById('importFile').addEventListener('change', e => this.importData(e.target.files[0]));
        this.bindSettingToggles('view-profile');
        Native.biometry().then(bio => {
            const row = document.getElementById('bioRow');
            if (!row || !bio.available) return;
            row.hidden = false;
            document.getElementById('bioTitle').textContent = `Unlock with ${bio.label}`;
            document.getElementById('bioToggle').addEventListener('change', async e => {
                const on = e.target.checked;
                if (on && !await Native.biometricCheck(`Confirm it's you to turn on ${bio.label} unlock`)) { e.target.checked = false; return; }
                Native.setBio(Store.userId, on);
                this.toast(on ? `${bio.label[0].toUpperCase()}${bio.label.slice(1)} unlock is on` : `${bio.label[0].toUpperCase()}${bio.label.slice(1)} unlock is off`, 'success');
            });
        });
    }

    exportData() {
        const blob = new Blob([JSON.stringify({ app: 'MoneyBook', exportedAt: new Date().toISOString(), data: this.data }, null, 2)], { type: 'application/json' });
        this.download(blob, `moneybook-${Store.userId}-${todayStr()}.json`);
        this.toast('Backup downloaded', 'success');
    }

    exportCsv() {
        const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [['Date', 'Type', 'Amount', 'Account', 'To Account', 'Category', 'Payment Mode', 'Note']]
            .concat([...this.data.transactions].sort((a, b) => a.date.localeCompare(b.date)).map(t => [
                t.date, t.type, t.amount, this.accountName(t.accountId), t.toAccountId ? this.accountName(t.toAccountId) : '',
                getCategory(t.category).name, t.paymentMode, t.note,
            ]));
        this.download(new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }), `moneybook-transactions-${todayStr()}.csv`);
    }

    download(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    async importData(file) {
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            const incoming = parsed.data || parsed;
            if (!Array.isArray(incoming.accounts) || !Array.isArray(incoming.transactions)) throw new Error('Not a MoneyBook backup file');
            if (!await this.confirm('Restore backup?', `This replaces all data for @${Store.userId} (also in the Google Sheet) with the backup (${incoming.transactions.length} transactions, ${incoming.accounts.length} accounts).`, 'Restore')) return;
            const base = emptyUserData(this.data.profile.displayName);
            Store.data = { ...base, ...incoming, settings: { ...base.settings, ...incoming.settings }, profile: { ...base.profile, ...incoming.profile } };
            await this.persist('Backup restored');
        } catch (err) {
            this.toast(err.message || 'Could not read that file', 'error');
        }
    }

    /* ========== SHEETS (FORMS) ========== */
    openSheet(title, html, onReady) {
        document.getElementById('sheetTitle').textContent = title;
        document.getElementById('sheetBody').innerHTML = html;
        document.getElementById('sheetOverlay').classList.add('show');
        document.body.classList.add('no-scroll');
        if (onReady) onReady(document.getElementById('sheetBody'));
    }

    closeSheet() {
        document.getElementById('sheetOverlay').classList.remove('show');
        document.body.classList.remove('no-scroll');
    }

    accountOptions(selectedId, { exclude = null } = {}) {
        return this.data.accounts.filter(a => (!a.archived || a.id === selectedId) && a.id !== exclude).map(a =>
            `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${escapeHtml(a.name)}${a.isMain ? ' (Main)' : ''} · ${formatCurrency(Calc.accountBalance(this.data, a))}</option>`).join('');
    }

    /* --- Transaction sheet (Expense / Income / Transfer) --- */
    openTxnSheet(txn, defaultType = 'Expense', draft = null) {
        const d = this.data;
        if (!this.activeAccounts().length) {
            this.toast('Add a bank account first', 'error');
            this.openAccountSheet(null, true);
            return;
        }
        if (!txn && defaultType === 'Transfer' && this.activeAccounts().length < 2) {
            this.toast('Add a second account to make transfers', 'error');
            return;
        }
        const isEdit = !!txn;
        const main = Calc.mainAccount(d);
        const last = d.settings.lastAccount || {};
        const state = {
            type: txn?.type || draft?.type || defaultType,
            category: txn?.category || draft?.category || null,
            paymentMode: txn?.paymentMode || draft?.paymentMode || 'UPI',
        };
        const accFor = type => txn?.accountId || draft?.accountId || (this.accountById(last[type]) && !this.accountById(last[type]).archived ? last[type] : main.id);
        const otherAccount = this.activeAccounts().find(a => a.id !== main.id);

        const html = `
            <form id="txnForm" class="sheet-form">
                ${draft ? `<div class="capture-note"><i class="fas ${draft.source === 'paste' ? 'fa-paste' : 'fa-share-nodes'}"></i> Filled in from the ${draft.source === 'paste' ? 'pasted text' : 'shared message'}${draft.last4 ? ` · ••${escapeHtml(draft.last4)}` : ''}${draft.accountId ? '' : ' · <b>pick the account</b>'}</div>
                ${Capture.duplicateOf(d, draft) ? `<div class="capture-note warn"><i class="fas fa-triangle-exclamation"></i> ${Capture.duplicateOf(d, draft).kind === 'ref' ? `Already added: same UPI ref (…${escapeHtml(draft.refNo.slice(-4))}).` : `You already have ${formatCurrency(draft.amount)} on ${friendlyDate(draft.date)}. Check it isn't a duplicate.`}</div>` : ''}` : ''}
                <div class="segmented type-tabs">
                    ${['Expense', 'Income', 'Transfer'].map(t => `<button type="button" data-type="${t}" class="${state.type === t ? 'active' : ''}">${t}</button>`).join('')}
                </div>
                <div class="amount-input">
                    <span>₹</span>
                    <input type="number" id="fAmount" inputmode="decimal" step="0.01" min="0.01" placeholder="0" value="${txn?.amount ?? draft?.amount ?? ''}" required>
                </div>
                <div id="catSection">
                    <label>Category</label>
                    <div class="cat-grid" id="catGrid"></div>
                </div>
                <div class="form-row" id="accSection">
                    <div class="form-group" id="fromGroup">
                        <label for="fAccount" id="fAccountLabel">Account</label>
                        <select id="fAccount">${this.accountOptions(accFor(state.type))}</select>
                    </div>
                    <div class="form-group" id="toGroup">
                        <label for="fToAccount">To account</label>
                        <select id="fToAccount">${this.accountOptions(txn?.toAccountId || otherAccount?.id)}</select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="fDate">Date</label>
                        <input type="date" id="fDate" value="${txn?.date || draft?.date || todayStr()}" required>
                    </div>
                    <div class="form-group">
                        <label for="fNote">Note</label>
                        <input type="text" id="fNote" placeholder="e.g., Swiggy, Petrol" value="${escapeHtml(txn?.note || draft?.note || '')}" maxlength="80">
                    </div>
                </div>
                <div id="modeSection">
                    <label>Paid via</label>
                    <div class="chip-scroll wrap" id="modeChips">
                        ${PAYMENT_MODES.map(m => `<button type="button" class="filter-chip ${state.paymentMode === m ? 'active' : ''}" data-mode="${m}">${m}</button>`).join('')}
                    </div>
                </div>
                <p class="auth-error" id="txnError"></p>
                <div class="btn-row">
                    ${isEdit ? `<button type="button" class="btn btn-danger-outline" id="txnDelete"><i class="fas fa-trash"></i></button>` : ''}
                    ${draft ? `<button type="button" class="btn btn-secondary" id="txnIgnore"><i class="fas fa-ban"></i> Ignore</button>` : ''}
                    <button type="submit" class="btn btn-primary grow"><i class="fas fa-check"></i> ${isEdit ? 'Update' : 'Save'}</button>
                </div>
            </form>`;

        this.openSheet(isEdit ? 'Edit transaction' : draft ? 'Review transaction' : 'New transaction', html, body => {
            const form = body.querySelector('#txnForm');
            const renderType = () => {
                body.querySelectorAll('.type-tabs button').forEach(b => b.classList.toggle('active', b.dataset.type === state.type));
                const isTransfer = state.type === 'Transfer';
                body.querySelector('#catSection').hidden = isTransfer;
                body.querySelector('#toGroup').hidden = !isTransfer;
                body.querySelector('#fAccountLabel').textContent = isTransfer ? 'From account' : state.type === 'Income' ? 'Received in' : 'Paid from';
                const cats = state.type === 'Income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
                if (!cats.find(c => c.id === state.category)) state.category = null;
                body.querySelector('#catGrid').innerHTML = cats.map(c => `
                    <button type="button" class="cat-tile ${state.category === c.id ? 'active' : ''}" data-cat="${c.id}">
                        <i class="${c.icon}"></i><span>${c.name}</span>
                    </button>`).join('');
                body.querySelectorAll('.cat-tile').forEach(tile => tile.addEventListener('click', () => {
                    state.category = tile.dataset.cat;
                    body.querySelectorAll('.cat-tile').forEach(t => t.classList.toggle('active', t === tile));
                }));
            };
            body.querySelectorAll('.type-tabs button').forEach(b => b.addEventListener('click', () => {
                state.type = b.dataset.type;
                if (!isEdit) body.querySelector('#fAccount').value = accFor(state.type);
                renderType();
            }));
            body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
                state.paymentMode = b.dataset.mode;
                body.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b));
            }));
            renderType();
            if (!isEdit && !draft) setTimeout(() => body.querySelector('#fAmount').focus(), 250);
            body.querySelector('#txnIgnore')?.addEventListener('click', async () => {
                await this.ignoreCapture(draft.captureId);
                this.closeSheet();
            });

            form.addEventListener('submit', async e => {
                e.preventDefault();
                const err = body.querySelector('#txnError');
                const amount = parseFloat(body.querySelector('#fAmount').value);
                const accountId = body.querySelector('#fAccount').value;
                const toAccountId = body.querySelector('#fToAccount').value;
                if (!(amount > 0)) { err.textContent = 'Enter an amount'; return; }
                if (state.type !== 'Transfer' && !state.category) { err.textContent = 'Pick a category'; return; }
                if (state.type === 'Transfer' && accountId === toAccountId) { err.textContent = 'From and To accounts must be different'; return; }

                const record = {
                    id: txn?.id || generateId(),
                    type: state.type, amount: Math.round(amount * 100) / 100,
                    date: body.querySelector('#fDate').value,
                    accountId,
                    category: state.type === 'Transfer' ? 'transfer' : state.category,
                    paymentMode: state.paymentMode,
                    note: body.querySelector('#fNote').value.trim(),
                    source: txn?.source || draft?.source || 'manual',
                    refNo: txn?.refNo || draft?.refNo || '',
                    time: txn?.time || draft?.time || (body.querySelector('#fDate').value === todayStr() && !isEdit ? new Date().toTimeString().slice(0, 5) : ''),
                };
                if (state.type === 'Transfer') record.toAccountId = toAccountId;
                if (draft) {
                    if (state.type !== 'Transfer') Capture.learn(d, record.note, record.category);
                    await this.resolveCaptures([draft.captureId]);
                }

                if (isEdit) d.transactions[d.transactions.findIndex(t => t.id === txn.id)] = record;
                else d.transactions.push(record);
                d.settings.lastAccount = { ...last, [state.type]: accountId };
                this.closeSheet();
                await this.persist(isEdit ? 'Transaction updated' : `${state.type} of ${formatCurrency(record.amount)} saved`);
                if (draft) await this.checkBankBalance([{ ...record, balanceAfter: draft.balanceAfter }]);
            });

            body.querySelector('#txnDelete')?.addEventListener('click', async () => {
                if (!await this.confirm('Delete transaction?', `${txn.type} of ${formatCurrency(txn.amount)} on ${formatDate(txn.date)} will be removed.`)) return;
                d.transactions = d.transactions.filter(t => t.id !== txn.id);
                this.closeSheet();
                await this.persist('Transaction deleted');
            });
        });
    }

    /* --- Account sheet --- */
    openAccountSheet(acc, onboarding = false) {
        const d = this.data;
        const isEdit = !!acc;
        const isFirst = !d.accounts.length;
        const color = acc?.color || ACCOUNT_COLORS[d.accounts.length % ACCOUNT_COLORS.length];
        const txnCount = isEdit ? d.transactions.filter(t => t.accountId === acc.id || t.toAccountId === acc.id).length : 0;

        const html = `
            <form id="accForm" class="sheet-form">
                ${onboarding ? `<p class="hint">Start with the account your salary comes into. You can add more accounts any time.</p>` : ''}
                <div class="form-group">
                    <label for="aName">Account name</label>
                    <input type="text" id="aName" placeholder="e.g., HDFC Salary, SBI Daily, Cash" value="${escapeHtml(acc?.name || '')}" maxlength="30" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="aBank">Bank (optional)</label>
                        <input type="text" id="aBank" placeholder="e.g., HDFC Bank" value="${escapeHtml(acc?.bank || '')}" maxlength="30">
                    </div>
                    <div class="form-group">
                        <label for="aType">Type</label>
                        <select id="aType">${ACCOUNT_TYPES.map(t => `<option ${t === (acc?.type || 'Savings') ? 'selected' : ''}>${t}</option>`).join('')}</select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="aLast4">Last 4 digits of account / debit card</label>
                    <input type="text" id="aLast4" inputmode="numeric" placeholder="e.g., 4521, 9012" value="${escapeHtml(acc?.last4 || '')}" maxlength="40">
                    <small>Used to match bank SMS to this account. Separate several with commas.</small>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="aOpening">Opening balance (₹)</label>
                        <input type="number" id="aOpening" inputmode="decimal" step="0.01" placeholder="0" value="${acc?.openingBalance ?? ''}">
                    </div>
                    <div class="form-group">
                        <label for="aOpeningDate">Balance as on</label>
                        <input type="date" id="aOpeningDate" value="${acc?.openingDate || todayStr()}" required>
                    </div>
                </div>
                ${isEdit ? `
                <div class="form-group">
                    <label for="aBankNow">Balance in bank right now (optional)</label>
                    <input type="number" id="aBankNow" inputmode="decimal" step="0.01" placeholder="MoneyBook shows ${escapeHtml(String(Calc.accountBalance(d, acc)))}">
                    <small>Enter what your bank app shows and MoneyBook adjusts the starting balance to match.</small>
                </div>` : ''}
                <label class="check-row">
                    <input type="checkbox" id="aMain" ${acc?.isMain || isFirst ? 'checked' : ''} ${isFirst ? 'disabled' : ''}>
                    <span><b>Main account</b> — shown first, and kept separate from "other accounts" on Home</span>
                </label>
                <label>Colour</label>
                <div class="swatches">
                    ${ACCOUNT_COLORS.map(c => `<button type="button" class="swatch-btn ${c === color ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}
                </div>
                ${isEdit && !acc.isMain ? `
                <label class="check-row">
                    <input type="checkbox" id="aArchived" ${acc.archived ? 'checked' : ''}>
                    <span>Archive (closed account — hidden from forms, history kept)</span>
                </label>` : ''}
                <p class="auth-error" id="accError"></p>
                <div class="btn-row">
                    ${isEdit && !acc.isMain ? `<button type="button" class="btn btn-danger-outline" id="accDelete" title="${txnCount ? 'Has transactions — archive instead' : 'Delete'}"><i class="fas fa-trash"></i></button>` : ''}
                    <button type="submit" class="btn btn-primary grow"><i class="fas fa-check"></i> ${isEdit ? 'Save account' : 'Add account'}</button>
                </div>
            </form>`;

        this.openSheet(isEdit ? 'Edit account' : 'Add bank account', html, body => {
            let chosenColor = color;
            body.querySelectorAll('.swatch-btn').forEach(b => b.addEventListener('click', () => {
                chosenColor = b.dataset.color;
                body.querySelectorAll('.swatch-btn').forEach(x => x.classList.toggle('active', x === b));
            }));
            setTimeout(() => body.querySelector('#aName').focus(), 250);

            body.querySelector('#accForm').addEventListener('submit', async e => {
                e.preventDefault();
                const name = body.querySelector('#aName').value.trim();
                if (d.accounts.some(a => a.name.toLowerCase() === name.toLowerCase() && a.id !== acc?.id)) {
                    body.querySelector('#accError').textContent = 'You already have an account with this name';
                    return;
                }
                const isMain = isFirst || body.querySelector('#aMain').checked;
                const archived = body.querySelector('#aArchived')?.checked || false;
                const record = {
                    id: acc?.id || generateId(),
                    name,
                    bank: body.querySelector('#aBank').value.trim(),
                    type: body.querySelector('#aType').value,
                    last4: body.querySelector('#aLast4').value.replace(/[^\d,\s]/g, '').trim(),
                    openingBalance: parseFloat(body.querySelector('#aOpening').value) || 0,
                    openingDate: body.querySelector('#aOpeningDate').value,
                    isMain: isMain && !archived,
                    color: chosenColor,
                    archived,
                };
                const bankNow = parseFloat(body.querySelector('#aBankNow')?.value);
                if (isEdit && isFinite(bankNow)) {
                    // Starting balance = bank balance minus everything recorded for this account
                    const movements = Calc.accountBalance(d, record) - (Number(record.openingBalance) || 0);
                    record.openingBalance = Math.round((bankNow - movements) * 100) / 100;
                }
                if (record.isMain) d.accounts.forEach(a => { a.isMain = false; });
                if (isEdit) d.accounts[d.accounts.findIndex(a => a.id === acc.id)] = record;
                else d.accounts.push(record);
                if (!d.accounts.some(a => a.isMain && !a.archived)) {
                    const fallback = d.accounts.find(a => !a.archived);
                    if (fallback) fallback.isMain = true;
                }
                this.closeSheet();
                await this.persist(isEdit ? 'Account updated' : `${name} added`);
            });

            body.querySelector('#accDelete')?.addEventListener('click', async () => {
                if (txnCount) {
                    this.toast(`${acc.name} has ${txnCount} transactions — tick "Archive" instead`, 'error');
                    return;
                }
                if (!await this.confirm('Delete account?', `${acc.name} will be removed.`)) return;
                d.accounts = d.accounts.filter(a => a.id !== acc.id);
                d.recurring.forEach(r => { if (r.accountId === acc.id) r.accountId = Calc.mainAccount(d)?.id; });
                this.closeSheet();
                await this.persist('Account deleted');
            });
        });
    }

    /* --- Savings target sheet --- */
    openTargetSheet() {
        const d = this.data;
        const override = d.savingsTargets[this.month];
        const s = Calc.monthStats(d, this.month);
        const avgIncome = (() => {
            const h = Calc.savingsHistory(d, shiftMonth(this.month, -1), 3).filter(r => r.income > 0);
            return h.length ? h.reduce((x, r) => x + r.income, 0) / h.length : s.income;
        })();
        const suggestions = avgIncome > 0 ? [10, 20, 30].map(p => Math.round(avgIncome * p / 100 / 100) * 100) : [];

        const html = `
            <form id="targetForm" class="sheet-form">
                <div class="form-group">
                    <label for="tDefault">Monthly savings target (every month)</label>
                    <div class="amount-input sm"><span>₹</span><input type="number" id="tDefault" inputmode="decimal" min="0" step="100" value="${d.settings.defaultSavingsTarget || ''}" placeholder="e.g., 20000"></div>
                    ${suggestions.length ? `<div class="chip-scroll wrap">${suggestions.map((v, i) => `<button type="button" class="filter-chip" data-suggest="${v}">${[10, 20, 30][i]}% of income · ${formatCurrency(v)}</button>`).join('')}</div>` : ''}
                </div>
                <label class="check-row">
                    <input type="checkbox" id="tOverrideOn" ${override !== undefined ? 'checked' : ''}>
                    <span>Use a different target just for <b>${monthLabel(this.month)}</b></span>
                </label>
                <div class="form-group" id="tOverrideGroup" ${override !== undefined ? '' : 'hidden'}>
                    <div class="amount-input sm"><span>₹</span><input type="number" id="tOverride" inputmode="decimal" min="0" step="100" value="${override ?? ''}"></div>
                </div>
                <label class="check-row">
                    <input type="checkbox" id="tInvest" ${d.settings.investmentsCountAsSavings ? 'checked' : ''}>
                    <span>Count <b>Investments / SIP</b> as savings (not as spending)</span>
                </label>
                <div class="btn-row"><button type="submit" class="btn btn-primary grow"><i class="fas fa-bullseye"></i> Save Target</button></div>
            </form>`;

        this.openSheet('Savings target', html, body => {
            const overrideOn = body.querySelector('#tOverrideOn');
            overrideOn.addEventListener('change', () => { body.querySelector('#tOverrideGroup').hidden = !overrideOn.checked; });
            body.querySelectorAll('[data-suggest]').forEach(b => b.addEventListener('click', () => { body.querySelector('#tDefault').value = b.dataset.suggest; }));
            body.querySelector('#targetForm').addEventListener('submit', async e => {
                e.preventDefault();
                d.settings.defaultSavingsTarget = parseFloat(body.querySelector('#tDefault').value) || 0;
                d.settings.investmentsCountAsSavings = body.querySelector('#tInvest').checked;
                if (overrideOn.checked) d.savingsTargets[this.month] = parseFloat(body.querySelector('#tOverride').value) || 0;
                else delete d.savingsTargets[this.month];
                this.closeSheet();
                await this.persist('Savings target saved');
            });
        });
    }

    /* --- Budget sheet --- */
    openBudgetSheet(budget) {
        const d = this.data;
        const isEdit = !!budget;
        const used = new Set(d.budgets.filter(b => b.month === this.month && b.id !== budget?.id).map(b => b.category));
        const html = `
            <form id="budgetForm" class="sheet-form">
                <p class="hint">For ${monthLabel(budget?.month || this.month)}</p>
                <div class="form-group">
                    <label for="bCat">Category</label>
                    <select id="bCat" required>${EXPENSE_CATEGORIES.filter(c => !used.has(c.id)).map(c => `<option value="${c.id}" ${c.id === budget?.category ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
                </div>
                <div class="form-group">
                    <label for="bAmt">Monthly limit</label>
                    <div class="amount-input sm"><span>₹</span><input type="number" id="bAmt" inputmode="decimal" min="1" value="${budget?.amount ?? ''}" required></div>
                </div>
                <div class="btn-row">
                    ${isEdit ? `<button type="button" class="btn btn-danger-outline" id="bDelete"><i class="fas fa-trash"></i></button>` : ''}
                    <button type="submit" class="btn btn-primary grow"><i class="fas fa-check"></i> Save Budget</button>
                </div>
            </form>`;
        this.openSheet(isEdit ? 'Edit budget' : 'Add budget', html, body => {
            body.querySelector('#budgetForm').addEventListener('submit', async e => {
                e.preventDefault();
                const record = { id: budget?.id || generateId(), month: budget?.month || this.month, category: body.querySelector('#bCat').value, amount: parseFloat(body.querySelector('#bAmt').value) };
                if (isEdit) d.budgets[d.budgets.findIndex(b => b.id === budget.id)] = record;
                else d.budgets.push(record);
                this.closeSheet();
                await this.persist('Budget saved');
            });
            body.querySelector('#bDelete')?.addEventListener('click', async () => {
                d.budgets = d.budgets.filter(b => b.id !== budget.id);
                this.closeSheet();
                await this.persist('Budget removed');
            });
        });
    }

    /* --- Recurring sheet --- */
    openRecurringSheet(rec) {
        const d = this.data;
        if (!this.activeAccounts().length) { this.toast('Add a bank account first', 'error'); return; }
        const isEdit = !!rec;
        const html = `
            <form id="recForm" class="sheet-form">
                <div class="form-group">
                    <label for="rName">Name</label>
                    <input type="text" id="rName" placeholder="e.g., SIP - Axis Bluechip, Netflix, Rent" value="${escapeHtml(rec?.name || '')}" maxlength="40" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="rAmt">Amount (₹)</label>
                        <input type="number" id="rAmt" inputmode="decimal" min="1" value="${rec?.amount ?? ''}" required>
                    </div>
                    <div class="form-group">
                        <label for="rCat">Category</label>
                        <select id="rCat">${EXPENSE_CATEGORIES.map(c => `<option value="${c.id}" ${c.id === (rec?.category || 'subscriptions') ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="rAcc">Debited from</label>
                    <select id="rAcc">${this.accountOptions(rec?.accountId || Calc.mainAccount(d).id)}</select>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="rFreq">Repeats</label>
                        <select id="rFreq">${['Monthly', 'Quarterly', 'Yearly'].map(f => `<option ${f === (rec?.frequency || 'Monthly') ? 'selected' : ''}>${f}</option>`).join('')}</select>
                    </div>
                    <div class="form-group">
                        <label for="rDay">Debit day (1–31)</label>
                        <input type="number" id="rDay" min="1" max="31" value="${rec?.debitDay ?? ''}" required>
                    </div>
                </div>
                <div class="form-group">
                    <label for="rStart">First debit month</label>
                    <input type="month" id="rStart" value="${rec?.startMonth || currentMonthKey()}" required>
                </div>
                <label class="check-row">
                    <input type="checkbox" id="rAuto" ${rec?.autoPost !== false ? 'checked' : ''}>
                    <span><b>Record automatically on the debit day</b> — banks often don't send an SMS for auto-debits, so the Google Sheet adds it for you. You'll get a reminder the day before.</span>
                </label>
                ${isEdit ? `<label class="check-row"><input type="checkbox" id="rActive" ${rec.isActive ? 'checked' : ''}><span>Active</span></label>` : ''}
                <div class="btn-row">
                    ${isEdit ? `<button type="button" class="btn btn-danger-outline" id="rDelete"><i class="fas fa-trash"></i></button>` : ''}
                    <button type="submit" class="btn btn-primary grow"><i class="fas fa-check"></i> Save</button>
                </div>
            </form>`;
        this.openSheet(isEdit ? 'Edit Auto-Debit' : 'Add Auto-Debit', html, body => {
            body.querySelector('#recForm').addEventListener('submit', async e => {
                e.preventDefault();
                const startMonth = body.querySelector('#rStart').value;
                const record = {
                    ...rec,
                    id: rec?.id || generateId(),
                    name: body.querySelector('#rName').value.trim(),
                    amount: parseFloat(body.querySelector('#rAmt').value),
                    category: body.querySelector('#rCat').value,
                    accountId: body.querySelector('#rAcc').value,
                    frequency: body.querySelector('#rFreq').value,
                    debitDay: Math.min(31, Math.max(1, parseInt(body.querySelector('#rDay').value, 10))),
                    startMonth,
                    isActive: isEdit ? body.querySelector('#rActive').checked : true,
                    autoPost: body.querySelector('#rAuto').checked,
                };
                if (rec && rec.startMonth !== startMonth) delete record.lastPaidMonth;
                if (isEdit) d.recurring[d.recurring.findIndex(r => r.id === rec.id)] = record;
                else d.recurring.push(record);
                this.closeSheet();
                await this.persist('Auto-debit saved');
            });
            body.querySelector('#rDelete')?.addEventListener('click', async () => {
                if (!await this.confirm('Delete auto-debit?', `${rec.name} will be removed. Past payments stay in your transactions.`)) return;
                d.recurring = d.recurring.filter(r => r.id !== rec.id);
                this.closeSheet();
                await this.persist('Auto-debit deleted');
            });
        });
    }

    /* --- Profile sheets --- */
    openNameSheet() {
        this.openSheet('Display name', `
            <form id="nameForm" class="sheet-form">
                <div class="form-group"><label for="pName">Name</label><input type="text" id="pName" value="${escapeHtml(this.data.profile.displayName)}" maxlength="40" required></div>
                <div class="btn-row"><button type="submit" class="btn btn-primary grow">Save</button></div>
            </form>`, body => {
            body.querySelector('#nameForm').addEventListener('submit', async e => {
                e.preventDefault();
                this.data.profile.displayName = body.querySelector('#pName').value.trim();
                document.getElementById('avatarBtn').textContent = this.initials(this.data.profile.displayName);
                this.closeSheet();
                await this.persist('Name updated');
            });
        });
    }

    openPasswordSheet() {
        this.openSheet('Change password', `
            <form id="pwForm" class="sheet-form">
                <div class="form-group"><label for="pwOld">Current password</label><input type="password" id="pwOld" autocomplete="current-password" required></div>
                <div class="form-group"><label for="pwNew">New password</label><input type="password" id="pwNew" autocomplete="new-password" minlength="6" required></div>
                <div class="form-group"><label for="pwNew2">Confirm new password</label><input type="password" id="pwNew2" autocomplete="new-password" minlength="6" required></div>
                <p class="auth-error" id="pwError"></p>
                <div class="btn-row"><button type="submit" class="btn btn-primary grow"><i class="fas fa-key"></i> Change Password</button></div>
            </form>`, body => {
            body.querySelector('#pwForm').addEventListener('submit', async e => {
                e.preventDefault();
                const err = body.querySelector('#pwError');
                if (body.querySelector('#pwNew').value !== body.querySelector('#pwNew2').value) { err.textContent = 'New passwords do not match'; return; }
                await this.withBusy(e.target.querySelector('button[type=submit]'), 'Saving…', async () => {
                    try {
                        await Store.changePassword(body.querySelector('#pwOld').value, body.querySelector('#pwNew').value);
                        this.closeSheet();
                        this.toast('Password changed', 'success');
                    } catch (ex) { err.textContent = ex.message; }
                });
            });
        });
    }

    async openDeleteProfileSheet() {
        const pending = Store.pendingCount();
        const warn = pending ? ` ${pending} change${pending === 1 ? ' has' : 's have'} not synced yet and will be lost.` : '';
        if (!await this.confirm('Remove from this device?', `@${Store.userId} will be logged out and the offline copy deleted from this device. Your data stays in the Google Sheet.${warn}`, 'Remove')) return;
        Store.forget();
        this.destroyCharts();
        this.showAuth();
        this.toast('Removed from this device');
    }

    /* ========== CONFIRM + TOAST ========== */
    confirm(title, text, okLabel = 'Delete') {
        return new Promise(resolve => {
            const modal = document.getElementById('confirmModal');
            document.getElementById('confirmTitle').textContent = title;
            document.getElementById('confirmText').textContent = text;
            const ok = document.getElementById('confirmOk');
            const cancel = document.getElementById('confirmCancel');
            ok.textContent = okLabel;
            ok.className = ['Delete', 'Remove'].includes(okLabel) ? 'btn btn-danger' : 'btn btn-primary';
            modal.classList.add('show');
            const done = result => {
                modal.classList.remove('show');
                ok.onclick = cancel.onclick = null;
                resolve(result);
            };
            ok.onclick = () => done(true);
            cancel.onclick = () => done(false);
        });
    }

    toast(message, type = 'info') {
        const el = document.getElementById('toast');
        el.textContent = message;
        el.className = `toast show ${type}`;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
