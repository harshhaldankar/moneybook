/* ========================================
   MONEYBOOK - App logic (views, forms, charts)
   ======================================== */

const TOP_VIEWS = ['home', 'activity', 'savings', 'more'];
const VIEW_TITLES = {
    home: 'Home', activity: 'Activity', savings: 'Savings', more: 'More',
    accounts: 'Bank Accounts', budgets: 'Budgets', recurring: 'Auto-Debits', reports: 'Reports', profile: 'Profile & Security',
};
const IDLE_LOCK_MS = 10 * 60 * 1000;

class App {
    constructor() {
        this.view = 'home';
        this.month = currentMonthKey();
        this.filters = { account: 'all', type: 'all', search: '' };
        this.charts = {};
        this.idleTimer = null;
    }

    get data() { return Vault.data; }

    async init() {
        this.bindAuth();
        this.bindShell();
        if (!Vault.isSupported()) {
            this.showAuthError('loginError', 'This browser blocks secure storage. Open the app over https:// (e.g. GitHub Pages) or from a local file.');
        }
        if (await Vault.restoreSession()) this.enterApp();
        else this.showAuth();

        if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
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

        document.getElementById('loginForm').addEventListener('submit', async e => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            this.showAuthError('loginError', '');
            await this.withBusy(btn, 'Checking…', async () => {
                try {
                    await Vault.signIn(document.getElementById('loginUser').value, document.getElementById('loginPass').value);
                    this.enterApp();
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
            const useLegacy = Legacy.exists() && document.getElementById('legacyImport').checked;
            await this.withBusy(btn, 'Creating…', async () => {
                try {
                    await Vault.signUp(document.getElementById('signupUser').value, name, pass, useLegacy ? Legacy.toUserData(name) : null);
                    if (useLegacy) Legacy.clear();
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

    showAuth(prefillUser = '') {
        document.getElementById('app').hidden = true;
        document.getElementById('authScreen').hidden = false;
        this.closeSheet();
        document.querySelectorAll('.auth-form').forEach(f => f.reset());
        const users = Vault.getUsers();
        const ids = Object.keys(users);
        document.getElementById('savedUsers').innerHTML = ids.length ? `
            <span class="saved-users-label">On this device</span>
            <div class="saved-users-list">${ids.map(id => `
                <button type="button" class="user-chip" data-user="${escapeHtml(id)}">
                    <span class="avatar sm">${escapeHtml(this.initials(users[id].displayName))}</span>
                    <span><b>${escapeHtml(users[id].displayName)}</b><small>@${escapeHtml(id)}</small></span>
                </button>`).join('')}
            </div>` : '';
        document.querySelectorAll('.user-chip').forEach(chip => chip.addEventListener('click', () => {
            document.getElementById('loginUser').value = chip.dataset.user;
            document.getElementById('loginPass').focus();
        }));
        document.getElementById('legacyImportRow').hidden = !Legacy.exists();
        this.switchAuthTab(ids.length ? 'login' : 'signup');
        if (prefillUser) {
            document.getElementById('loginUser').value = prefillUser;
            document.getElementById('loginPass').focus();
        }
    }

    enterApp() {
        document.getElementById('authScreen').hidden = true;
        document.getElementById('app').hidden = false;
        document.getElementById('avatarBtn').textContent = this.initials(this.data.profile.displayName);
        this.month = currentMonthKey();
        this.navigate('home');
        this.resetIdleTimer();
    }

    lock() {
        const user = Vault.username;
        Vault.signOut();
        this.destroyCharts();
        this.showAuth(user);
        this.toast('Locked. Enter your password to continue.');
    }

    logout() {
        Vault.signOut();
        this.destroyCharts();
        this.showAuth();
    }

    resetIdleTimer() {
        clearTimeout(this.idleTimer);
        if (!Vault.username) return;
        this.idleTimer = setTimeout(() => this.lock(), IDLE_LOCK_MS);
    }

    initials(name) {
        return String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    }

    /* ========== SHELL / NAVIGATION ========== */
    bindShell() {
        document.querySelectorAll('.nav-item').forEach(a => a.addEventListener('click', e => {
            e.preventDefault();
            this.navigate(a.dataset.view);
        }));
        document.getElementById('backBtn').addEventListener('click', () => this.navigate('more'));
        document.getElementById('lockBtn').addEventListener('click', () => this.lock());
        document.getElementById('avatarBtn').addEventListener('click', () => this.navigate('profile'));
        document.getElementById('sheetClose').addEventListener('click', () => this.closeSheet());
        document.getElementById('sheetOverlay').addEventListener('click', e => { if (e.target.id === 'sheetOverlay') this.closeSheet(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeSheet(); });
        ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => this.resetIdleTimer(), { passive: true }));

        // One delegated handler for every [data-action] in the app and sheet
        document.addEventListener('click', e => {
            const el = e.target.closest('[data-action]');
            if (!el || !Vault.data) return;
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
        if (!Vault.data) return;
        const renderers = {
            home: () => this.renderHome(), activity: () => this.renderActivity(), savings: () => this.renderSavings(),
            more: () => this.renderMore(), accounts: () => this.renderAccounts(), budgets: () => this.renderBudgets(),
            recurring: () => this.renderRecurring(), reports: () => this.renderReports(), profile: () => this.renderProfile(),
        };
        renderers[this.view]();
    }

    async persist(message) {
        await Vault.save();
        this.render();
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
    renderHome() {
        const d = this.data;
        const el = document.getElementById('view-home');
        const firstName = escapeHtml(d.profile.displayName.split(' ')[0]);

        if (!d.accounts.length) {
            el.innerHTML = `
                <p class="greeting">Hi ${firstName} 👋</p>
                <div class="card empty-hero">
                    <i class="fas fa-building-columns"></i>
                    <h2>Add your bank accounts</h2>
                    <p>Add every account you use (salary account, daily-use account, cash wallet…). Pick one as your <b>Main</b> account.</p>
                    <button class="btn btn-primary" data-action="add-account"><i class="fas fa-plus"></i> Add Account</button>
                </div>`;
            return;
        }

        const split = Calc.balanceSplit(d);
        const s = Calc.monthStats(d, this.month);
        const accounts = this.activeAccounts();

        el.innerHTML = `
            <p class="greeting">Hi ${firstName} 👋</p>

            <div class="card hero-card">
                <span class="hero-label">Total Balance</span>
                <span class="hero-value">${formatCurrency(split.total)}</span>
                <div class="hero-split">
                    <div>
                        <span class="hero-sub"><i class="fas fa-star"></i> Main · ${escapeHtml(split.main?.name || '-')}</span>
                        <b>${formatCurrency(split.mainBal)}</b>
                    </div>
                    <div>
                        <span class="hero-sub">Other ${accounts.length - 1 === 1 ? 'account' : 'accounts'} (${Math.max(accounts.length - 1, 0)})</span>
                        <b>${formatCurrency(split.othersBal)}</b>
                    </div>
                </div>
            </div>

            <div class="account-scroller">
                ${accounts.map(a => `
                    <button class="account-chip" data-action="filter-account" data-id="${a.id}" style="--acc:${a.color}">
                        <span class="acc-name">${a.isMain ? '<i class="fas fa-star"></i> ' : ''}${escapeHtml(a.name)}</span>
                        <span class="acc-type">${escapeHtml(a.bank || a.type)}</span>
                        <span class="acc-bal">${formatCurrency(Calc.accountBalance(d, a))}</span>
                    </button>`).join('')}
                <button class="account-chip add" data-action="add-account"><i class="fas fa-plus"></i><span>Add account</span></button>
            </div>

            <div class="quick-actions">
                <button data-action="add-txn" data-type="Expense"><i class="fas fa-arrow-up expense-c"></i>Expense</button>
                <button data-action="add-txn" data-type="Income"><i class="fas fa-arrow-down income-c"></i>Income</button>
                <button data-action="add-txn" data-type="Transfer"><i class="fas fa-arrow-right-arrow-left"></i>Transfer</button>
                <button data-action="edit-target"><i class="fas fa-bullseye"></i>Target</button>
            </div>

            ${this.monthSwitcher()}

            <div class="card">
                <div class="stat-row">
                    <div class="stat"><span>Income</span><b class="income-c">${formatCurrency(s.income)}</b></div>
                    <div class="stat"><span>Spent</span><b class="expense-c">${formatCurrency(s.spent)}</b></div>
                    <div class="stat"><span>Saved</span><b>${formatCurrency(s.saved)}</b></div>
                </div>
                ${this.targetBlock(s)}
                <div class="carry-row">
                    <div><span>Carried in from ${monthLabel(shiftMonth(this.month, -1), true)}</span><b>${formatCurrency(s.openingBalance)}</b></div>
                    <i class="fas fa-arrow-right"></i>
                    <div><span>Carry forward to ${monthLabel(shiftMonth(this.month, 1), true)}</span><b>${formatCurrency(s.closingBalance)}</b></div>
                </div>
                <button class="link-btn" data-action="go" data-view="savings">See month-on-month savings →</button>
            </div>

            ${this.budgetAlerts()}
            ${this.upcomingRecurringCard()}

            <div class="card">
                <div class="card-header">
                    <h3>Recent Transactions</h3>
                    <button class="link-btn" data-action="go" data-view="activity">View all →</button>
                </div>
                ${this.txnListHtml([...d.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 6), false)}
            </div>`;
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
                <div class="card-header"><h3>Budget Alerts</h3><button class="link-btn" data-action="go" data-view="budgets">Budgets →</button></div>
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
        if (!txns.length) return `<div class="empty-state"><i class="fas fa-receipt"></i><p>No transactions yet</p></div>`;
        let lastDate = null;
        return `<div class="txn-list">${txns.map(t => {
            const cat = getCategory(t.category);
            const header = groupByDate && t.date !== lastDate ? `<div class="date-header">${formatDate(t.date)}</div>` : '';
            lastDate = t.date;
            const isTransfer = t.type === 'Transfer';
            const sub = isTransfer
                ? `${escapeHtml(this.accountName(t.accountId))} → ${escapeHtml(this.accountName(t.toAccountId))}`
                : `${escapeHtml(this.accountName(t.accountId))}${t.paymentMode ? ' · ' + escapeHtml(t.paymentMode) : ''}${groupByDate ? '' : ' · ' + formatDate(t.date)}`;
            const amtClass = isTransfer ? 'transfer-c' : t.type === 'Income' ? 'income-c' : 'expense-c';
            const sign = isTransfer ? '' : t.type === 'Income' ? '+' : '-';
            return `${header}
                <button class="txn-row" data-action="edit-txn" data-id="${t.id}">
                    <span class="txn-icon ${t.type.toLowerCase()}"><i class="${cat.icon}"></i></span>
                    <span class="txn-main">
                        <b>${escapeHtml(t.note || cat.name)}</b>
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
            .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

        const inSum = txns.filter(t => t.type === 'Income').reduce((s, t) => s + Number(t.amount), 0);
        const outSum = txns.filter(t => t.type === 'Expense').reduce((s, t) => s + Number(t.amount), 0);

        el.innerHTML = `
            ${this.monthSwitcher()}
            <div class="filter-bar">
                <div class="search-box"><i class="fas fa-magnifying-glass"></i><input type="search" id="actSearch" placeholder="Search notes, category, amount" value="${escapeHtml(f.search)}"></div>
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
                <div class="card-header"><h3>${monthLabel(this.month)}</h3><button class="link-btn" data-action="edit-target"><i class="fas fa-pen"></i> Target</button></div>
                <div class="big-number">
                    <span>Saved this month</span>
                    <b class="${s.saved < 0 ? 'expense-c' : ''}">${formatCurrency(s.saved)}</b>
                </div>
                ${this.targetBlock(s)}
            </div>

            <div class="card">
                <h3>Carry Forward</h3>
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
                        <thead><tr><th>Month</th><th>Income</th><th>Spent</th><th>Saved</th><th>Target</th><th>vs Target</th><th>Carry Fwd</th></tr></thead>
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
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: this.cssVar('--text-muted') }, border: { color: this.cssVar('--border') } },
                y: { grid: { color: this.cssVar('--grid') }, border: { display: false }, ticks: { color: this.cssVar('--text-muted'), callback: v => formatCompact(v) } },
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
                <div><b>${escapeHtml(d.profile.displayName)}</b><small>@${escapeHtml(Vault.username)}</small></div>
                <i class="fas fa-chevron-right"></i>
            </div>
            <div class="card flush menu">
                ${item('accounts', 'fas fa-building-columns', 'Bank Accounts', `${this.activeAccounts().length} active · add, edit, set main`)}
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
                <span class="acc-avatar" style="background:${a.color}"><i class="fas ${a.type === 'Cash / Wallet' ? 'fa-wallet' : a.type === 'Credit Card' ? 'fa-credit-card' : 'fa-building-columns'}"></i></span>
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
                <div class="card-header"><h3>Upcoming Auto-Debits</h3><button class="link-btn" data-action="go" data-view="recurring">All →</button></div>
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
                ${r.isActive ? `<button class="chip-btn" data-action="pay-recurring" data-id="${r.id}"><i class="fas fa-check"></i> Paid</button>` : ''}
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
            <p class="hint center">Tap <b>Paid</b> when it's debited — it's recorded as an expense in the right account.</p>`;
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
                    { label: 'Income', data: stats.map(s => s.income), backgroundColor: this.cssVar('--series-1'), borderRadius: 4, maxBarThickness: 22 },
                    { label: 'Expenses', data: stats.map(s => s.spent + s.invested), backgroundColor: this.cssVar('--series-2'), borderRadius: 4, maxBarThickness: 22 },
                ],
            },
            options: this.chartDefaults(),
        });
    }

    /* ========== PROFILE ========== */
    renderProfile() {
        const d = this.data;
        const user = Vault.getUsers()[Vault.username];
        document.getElementById('view-profile').innerHTML = `
            <div class="card profile-card">
                <span class="avatar lg">${escapeHtml(this.initials(d.profile.displayName))}</span>
                <div><b>${escapeHtml(d.profile.displayName)}</b><small>User ID: @${escapeHtml(Vault.username)} · since ${formatDate(user.createdAt.slice(0, 10))}</small></div>
            </div>
            <div class="card flush menu">
                <button class="menu-item" data-action="edit-name"><span class="menu-icon"><i class="fas fa-id-card"></i></span><span class="menu-text"><b>Change display name</b></span><i class="fas fa-chevron-right"></i></button>
                <button class="menu-item" data-action="change-password"><span class="menu-icon"><i class="fas fa-key"></i></span><span class="menu-text"><b>Change password</b></span><i class="fas fa-chevron-right"></i></button>
            </div>
            <div class="card flush menu">
                <button class="menu-item" data-action="export"><span class="menu-icon"><i class="fas fa-download"></i></span><span class="menu-text"><b>Download backup (JSON)</b><small>Restore it on any device</small></span></button>
                <button class="menu-item" data-action="export-csv"><span class="menu-icon"><i class="fas fa-file-csv"></i></span><span class="menu-text"><b>Export transactions (CSV)</b><small>Open in Excel / Google Sheets</small></span></button>
                <button class="menu-item" data-action="import"><span class="menu-icon"><i class="fas fa-upload"></i></span><span class="menu-text"><b>Restore from backup</b><small>Replaces your current data</small></span></button>
                <input type="file" id="importFile" accept=".json,application/json" hidden>
            </div>
            <div class="card flush menu">
                <button class="menu-item danger" data-action="delete-profile"><span class="menu-icon"><i class="fas fa-user-xmark"></i></span><span class="menu-text"><b>Delete my profile</b><small>Removes your data from this device</small></span></button>
            </div>
            <p class="hint center"><i class="fas fa-lock"></i> Data is stored on this device only, encrypted with your password.<br>Other users on this device cannot read it.</p>`;
        document.getElementById('importFile').addEventListener('change', e => this.importData(e.target.files[0]));
    }

    exportData() {
        const blob = new Blob([JSON.stringify({ app: 'MoneyBook', exportedAt: new Date().toISOString(), data: this.data }, null, 2)], { type: 'application/json' });
        this.download(blob, `moneybook-${Vault.username}-${todayStr()}.json`);
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
            if (!await this.confirm('Restore backup?', `This replaces all data for @${Vault.username} with the backup (${incoming.transactions.length} transactions, ${incoming.accounts.length} accounts).`, 'Restore')) return;
            const base = emptyUserData(this.data.profile.displayName);
            Vault.data = { ...base, ...incoming, settings: { ...base.settings, ...incoming.settings }, profile: { ...base.profile, ...incoming.profile } };
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
    openTxnSheet(txn, defaultType = 'Expense') {
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
            type: txn?.type || defaultType,
            category: txn?.category || null,
            paymentMode: txn?.paymentMode || 'UPI',
        };
        const accFor = type => txn?.accountId || (this.accountById(last[type]) && !this.accountById(last[type]).archived ? last[type] : main.id);
        const otherAccount = this.activeAccounts().find(a => a.id !== main.id);

        const html = `
            <form id="txnForm" class="sheet-form">
                <div class="segmented type-tabs">
                    ${['Expense', 'Income', 'Transfer'].map(t => `<button type="button" data-type="${t}" class="${state.type === t ? 'active' : ''}">${t}</button>`).join('')}
                </div>
                <div class="amount-input">
                    <span>₹</span>
                    <input type="number" id="fAmount" inputmode="decimal" step="0.01" min="0.01" placeholder="0" value="${txn?.amount ?? ''}" required>
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
                        <label for="fToAccount">To Account</label>
                        <select id="fToAccount">${this.accountOptions(txn?.toAccountId || otherAccount?.id)}</select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="fDate">Date</label>
                        <input type="date" id="fDate" value="${txn?.date || todayStr()}" required>
                    </div>
                    <div class="form-group">
                        <label for="fNote">Note</label>
                        <input type="text" id="fNote" placeholder="e.g., Swiggy, Petrol" value="${escapeHtml(txn?.note || '')}" maxlength="80">
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
                    <button type="submit" class="btn btn-primary grow"><i class="fas fa-check"></i> ${isEdit ? 'Update' : 'Save'}</button>
                </div>
            </form>`;

        this.openSheet(isEdit ? 'Edit Transaction' : 'New Transaction', html, body => {
            const form = body.querySelector('#txnForm');
            const renderType = () => {
                body.querySelectorAll('.type-tabs button').forEach(b => b.classList.toggle('active', b.dataset.type === state.type));
                const isTransfer = state.type === 'Transfer';
                body.querySelector('#catSection').hidden = isTransfer;
                body.querySelector('#toGroup').hidden = !isTransfer;
                body.querySelector('#fAccountLabel').textContent = isTransfer ? 'From Account' : state.type === 'Income' ? 'Received in' : 'Paid from';
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
            if (!isEdit) setTimeout(() => body.querySelector('#fAmount').focus(), 250);

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
                };
                if (state.type === 'Transfer') record.toAccountId = toAccountId;

                if (isEdit) d.transactions[d.transactions.findIndex(t => t.id === txn.id)] = record;
                else d.transactions.push(record);
                d.settings.lastAccount = { ...last, [state.type]: accountId };
                this.closeSheet();
                await this.persist(isEdit ? 'Transaction updated' : `${state.type} of ${formatCurrency(record.amount)} saved`);
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
                    <button type="submit" class="btn btn-primary grow"><i class="fas fa-check"></i> ${isEdit ? 'Update Account' : 'Add Account'}</button>
                </div>
            </form>`;

        this.openSheet(isEdit ? 'Edit Account' : 'Add Bank Account', html, body => {
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
                    openingBalance: parseFloat(body.querySelector('#aOpening').value) || 0,
                    openingDate: body.querySelector('#aOpeningDate').value,
                    isMain: isMain && !archived,
                    color: chosenColor,
                    archived,
                };
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

        this.openSheet('Savings Target', html, body => {
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
        this.openSheet(isEdit ? 'Edit Budget' : 'Add Budget', html, body => {
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
        this.openSheet('Display Name', `
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
        this.openSheet('Change Password', `
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
                        await Vault.changePassword(body.querySelector('#pwOld').value, body.querySelector('#pwNew').value);
                        this.closeSheet();
                        this.toast('Password changed', 'success');
                    } catch (ex) { err.textContent = ex.message; }
                });
            });
        });
    }

    openDeleteProfileSheet() {
        this.openSheet('Delete Profile', `
            <form id="delForm" class="sheet-form">
                <p class="hint">This permanently deletes <b>@${escapeHtml(Vault.username)}</b> and all its data from this device. Download a backup first if you might need it.</p>
                <div class="form-group"><label for="delPw">Enter your password to confirm</label><input type="password" id="delPw" autocomplete="current-password" required></div>
                <p class="auth-error" id="delError"></p>
                <div class="btn-row"><button type="submit" class="btn btn-danger grow"><i class="fas fa-user-xmark"></i> Delete Permanently</button></div>
            </form>`, body => {
            body.querySelector('#delForm').addEventListener('submit', async e => {
                e.preventDefault();
                try {
                    await Vault.deleteCurrentUser(body.querySelector('#delPw').value);
                    this.destroyCharts();
                    this.showAuth();
                    this.toast('Profile deleted');
                } catch (ex) { body.querySelector('#delError').textContent = ex.message; }
            });
        });
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
            ok.className = okLabel === 'Delete' ? 'btn btn-danger' : 'btn btn-primary';
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
