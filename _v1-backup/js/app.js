/* ========================================
   EXPENSE MANAGER - MAIN APPLICATION
   ======================================== */

// App initialization is handled at the bottom of this file

class ExpenseApp {
    constructor() {
        this.currentMonth = new Date();
        this.budgetMonth = new Date();
        this.reportMonth = new Date();
        this.charts = {};
        this.pendingDeleteId = null;
        this.pendingDeleteType = null;
    }

    init() {
        this.loadSettings();
        this.setupNavigation();
        this.setupForms();
        this.setupFilters();
        this.setupSettings();
        this.setupMonthSelectors();
        this.populateCategoryDropdowns();
        this.setDefaultDates();
        this.renderDashboard();
    }

    /* ============================
       NAVIGATION
    ============================ */
    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');
        const viewAllLinks = document.querySelectorAll('.view-all-link');
        const menuBtn = document.getElementById('menuBtn');
        const sidebar = document.getElementById('sidebar');

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const view = link.dataset.view;
                this.switchView(view);
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                sidebar.classList.remove('open');
            });
        });

        viewAllLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const view = link.dataset.view;
                this.switchView(view);
                navLinks.forEach(l => {
                    l.classList.toggle('active', l.dataset.view === view);
                });
            });
        });

        menuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });

        // Close sidebar on outside click (mobile)
        document.addEventListener('click', (e) => {
            if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        });
    }

    switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const view = document.getElementById(`view-${viewId}`);
        if (view) {
            view.classList.add('active');
            this.onViewActivated(viewId);
        }
    }

    onViewActivated(viewId) {
        switch (viewId) {
            case 'dashboard': this.renderDashboard(); break;
            case 'transactions': this.renderTransactions(); break;
            case 'add-transaction': this.setDefaultDates(); break;
            case 'transfer': this.renderTransferView(); break;
            case 'recurring': this.renderRecurring(); break;
            case 'budgets': this.renderBudgets(); break;
            case 'reports': this.renderReports(); break;
            case 'settings': this.loadSettingsForm(); break;
        }
    }

    /* ============================
       SETTINGS
    ============================ */
    loadSettings() {
        this.settings = Storage.get('settings', { ...DEFAULT_SETTINGS });
    }

    setupSettings() {
        const form = document.getElementById('settingsForm');
        const exportBtn = document.getElementById('exportData');
        const importFile = document.getElementById('importFile');
        const clearBtn = document.getElementById('clearData');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.settings.acc1Name = document.getElementById('settAcc1Name').value || 'Account 1';
            this.settings.acc2Name = document.getElementById('settAcc2Name').value || 'Account 2';
            this.settings.acc1OpeningBalance = parseFloat(document.getElementById('settAcc1Balance').value) || 0;
            this.settings.acc2OpeningBalance = parseFloat(document.getElementById('settAcc2Balance').value) || 0;
            Storage.set('settings', this.settings);
            this.showToast('Settings saved!', 'success');
            this.renderDashboard();
        });

        exportBtn.addEventListener('click', () => {
            const data = Storage.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `expense_data_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('Data exported!', 'success');
        });

        importFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    Storage.importAll(data);
                    this.loadSettings();
                    this.renderDashboard();
                    this.showToast('Data imported!', 'success');
                } catch {
                    this.showToast('Invalid file format', 'error');
                }
            };
            reader.readAsText(file);
        });

        clearBtn.addEventListener('click', () => {
            if (confirm('⚠️ This will delete ALL your data. Are you sure?')) {
                Storage.clearAll();
                this.settings = { ...DEFAULT_SETTINGS };
                this.renderDashboard();
                this.showToast('All data cleared', 'info');
            }
        });
    }

    loadSettingsForm() {
        document.getElementById('settAcc1Name').value = this.settings.acc1Name;
        document.getElementById('settAcc2Name').value = this.settings.acc2Name;
        document.getElementById('settAcc1Balance').value = this.settings.acc1OpeningBalance || '';
        document.getElementById('settAcc2Balance').value = this.settings.acc2OpeningBalance || '';
    }

    /* ============================
       FORMS SETUP
    ============================ */
    setupForms() {
        // Transaction Form
        const txnForm = document.getElementById('transactionForm');
        txnForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTransaction();
        });

        // Type selector buttons
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Transfer Form
        const transferForm = document.getElementById('transferForm');
        transferForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTransfer();
        });

        // Recurring Form
        const recForm = document.getElementById('recurringForm');
        recForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addRecurring();
        });

        // Budget Form
        const budgetForm = document.getElementById('budgetForm');
        budgetForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addBudget();
        });

        // Delete modal
        document.getElementById('confirmDelete').addEventListener('click', () => {
            this.confirmDelete();
        });
        document.getElementById('cancelDelete').addEventListener('click', () => {
            this.hideDeleteModal();
        });
    }

    setDefaultDates() {
        const today = new Date().toISOString().split('T')[0];
        const dateFields = ['txnDate', 'transferDate'];
        dateFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = today;
        });
    }

    populateCategoryDropdowns() {
        const selects = ['txnCategory', 'recCategory', 'budgetCategory', 'filterCategory'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;

            // Keep the first option (placeholder)
            const firstOption = select.options[0];
            select.innerHTML = '';
            select.appendChild(firstOption);

            CATEGORIES.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                select.appendChild(opt);
            });
        });
    }

    /* ============================
       MONTH SELECTORS
    ============================ */
    setupMonthSelectors() {
        // Dashboard
        document.getElementById('prevMonth').addEventListener('click', () => {
            this.currentMonth.setMonth(this.currentMonth.getMonth() - 1);
            this.renderDashboard();
        });
        document.getElementById('nextMonth').addEventListener('click', () => {
            this.currentMonth.setMonth(this.currentMonth.getMonth() + 1);
            this.renderDashboard();
        });

        // Budgets
        document.getElementById('budgetPrevMonth').addEventListener('click', () => {
            this.budgetMonth.setMonth(this.budgetMonth.getMonth() - 1);
            this.renderBudgets();
        });
        document.getElementById('budgetNextMonth').addEventListener('click', () => {
            this.budgetMonth.setMonth(this.budgetMonth.getMonth() + 1);
            this.renderBudgets();
        });

        // Reports
        document.getElementById('reportPrevMonth').addEventListener('click', () => {
            this.reportMonth.setMonth(this.reportMonth.getMonth() - 1);
            this.renderReports();
        });
        document.getElementById('reportNextMonth').addEventListener('click', () => {
            this.reportMonth.setMonth(this.reportMonth.getMonth() + 1);
            this.renderReports();
        });
    }

    /* ============================
       TRANSACTIONS CRUD
    ============================ */
    getTransactions() {
        return Storage.get('transactions', []);
    }

    saveTransactions(txns) {
        Storage.set('transactions', txns);
    }

    addTransaction() {
        const type = document.querySelector('.type-btn.active').dataset.type;
        const amount = parseFloat(document.getElementById('txnAmount').value);
        const date = document.getElementById('txnDate').value;
        const account = document.getElementById('txnAccount').value;
        const category = document.getElementById('txnCategory').value;
        const paymentMode = document.getElementById('txnPaymentMode').value;
        const subCategory = document.getElementById('txnSubCategory').value;
        const note = document.getElementById('txnNote').value;

        if (!amount || !date || !category) {
            this.showToast('Please fill all required fields', 'error');
            return;
        }

        const txn = {
            id: generateId(),
            type,
            amount,
            date,
            account,
            category,
            paymentMode,
            subCategory,
            note,
            createdAt: new Date().toISOString()
        };

        const txns = this.getTransactions();
        txns.push(txn);
        this.saveTransactions(txns);

        document.getElementById('transactionForm').reset();
        document.querySelector('.type-btn[data-type="Expense"]').click();
        this.setDefaultDates();

        this.showToast(`${type} of ${formatCurrency(amount)} added!`, 'success');
    }

    addTransfer() {
        const from = document.getElementById('transferFrom').value;
        const to = document.getElementById('transferTo').value;
        const amount = parseFloat(document.getElementById('transferAmount').value);
        const date = document.getElementById('transferDate').value;
        const note = document.getElementById('transferNote').value;

        if (from === to) {
            this.showToast('Cannot transfer to the same account', 'error');
            return;
        }

        if (!amount || !date) {
            this.showToast('Please fill all required fields', 'error');
            return;
        }

        const txns = this.getTransactions();

        // Create two linked transactions
        const transferId = generateId();
        txns.push({
            id: transferId + '_out',
            type: 'Transfer',
            amount,
            date,
            account: from,
            category: 'transfers',
            paymentMode: 'Net Banking',
            subCategory: `To ${to}`,
            note: note || `Transfer to ${to}`,
            transferDirection: 'out',
            linkedId: transferId + '_in',
            createdAt: new Date().toISOString()
        });

        txns.push({
            id: transferId + '_in',
            type: 'Transfer',
            amount,
            date,
            account: to,
            category: 'transfers',
            paymentMode: 'Net Banking',
            subCategory: `From ${from}`,
            note: note || `Transfer from ${from}`,
            transferDirection: 'in',
            linkedId: transferId + '_out',
            createdAt: new Date().toISOString()
        });

        this.saveTransactions(txns);
        document.getElementById('transferForm').reset();
        this.setDefaultDates();

        this.showToast(`${formatCurrency(amount)} transferred from ${from} to ${to}!`, 'success');
        this.renderTransferView();
    }

    deleteTransaction(id) {
        this.pendingDeleteId = id;
        this.pendingDeleteType = 'transaction';
        document.getElementById('deleteModal').classList.add('active');
    }

    confirmDelete() {
        if (this.pendingDeleteType === 'transaction') {
            let txns = this.getTransactions();
            const txn = txns.find(t => t.id === this.pendingDeleteId);

            // If it's a transfer, delete the linked transaction too
            if (txn && txn.linkedId) {
                txns = txns.filter(t => t.id !== this.pendingDeleteId && t.id !== txn.linkedId);
            } else {
                txns = txns.filter(t => t.id !== this.pendingDeleteId);
            }

            this.saveTransactions(txns);
            this.showToast('Transaction deleted', 'info');
        } else if (this.pendingDeleteType === 'recurring') {
            let items = Storage.get('recurring', []);
            items = items.filter(r => r.id !== this.pendingDeleteId);
            Storage.set('recurring', items);
            this.showToast('Recurring item deleted', 'info');
            this.renderRecurring();
        } else if (this.pendingDeleteType === 'budget') {
            let budgets = Storage.get('budgets', []);
            budgets = budgets.filter(b => b.id !== this.pendingDeleteId);
            Storage.set('budgets', budgets);
            this.showToast('Budget deleted', 'info');
            this.renderBudgets();
        }

        this.hideDeleteModal();
        this.renderDashboard();
        this.renderTransactions();
    }

    hideDeleteModal() {
        document.getElementById('deleteModal').classList.remove('active');
        this.pendingDeleteId = null;
        this.pendingDeleteType = null;
    }

    /* ============================
       RECURRING CRUD
    ============================ */
    addRecurring() {
        const name = document.getElementById('recName').value;
        const amount = parseFloat(document.getElementById('recAmount').value);
        const category = document.getElementById('recCategory').value;
        const account = document.getElementById('recAccount').value;
        const frequency = document.getElementById('recFrequency').value;
        const debitDay = parseInt(document.getElementById('recDebitDay').value);

        if (!name || !amount || !category || !debitDay) {
            this.showToast('Please fill all required fields', 'error');
            return;
        }

        const items = Storage.get('recurring', []);
        items.push({
            id: generateId(),
            name,
            amount,
            category,
            account,
            frequency,
            debitDay,
            isActive: true,
            createdAt: new Date().toISOString()
        });

        Storage.set('recurring', items);
        document.getElementById('recurringForm').reset();
        this.showToast(`Recurring item "${name}" added!`, 'success');
        this.renderRecurring();
    }

    /* ============================
       BUDGET CRUD
    ============================ */
    addBudget() {
        const category = document.getElementById('budgetCategory').value;
        const amount = parseFloat(document.getElementById('budgetAmount').value);
        const monthKey = getMonthKey(this.budgetMonth);

        if (!category || !amount) {
            this.showToast('Please fill all required fields', 'error');
            return;
        }

        let budgets = Storage.get('budgets', []);

        // Check if budget for this category and month exists
        const existing = budgets.find(b => b.category === category && b.month === monthKey);
        if (existing) {
            existing.amount = amount;
        } else {
            budgets.push({
                id: generateId(),
                month: monthKey,
                category,
                amount,
                createdAt: new Date().toISOString()
            });
        }

        Storage.set('budgets', budgets);
        document.getElementById('budgetForm').reset();
        this.showToast(`Budget for ${getCategoryName(category)} set to ${formatCurrency(amount)}`, 'success');
        this.renderBudgets();
    }

    /* ============================
       FILTERS
    ============================ */
    setupFilters() {
        ['filterAccount', 'filterType', 'filterCategory', 'filterSearch'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
                    this.renderTransactions();
                });
            }
        });
    }

    getFilteredTransactions() {
        let txns = this.getTransactions();
        const account = document.getElementById('filterAccount').value;
        const type = document.getElementById('filterType').value;
        const category = document.getElementById('filterCategory').value;
        const search = document.getElementById('filterSearch').value.toLowerCase();

        if (account !== 'all') txns = txns.filter(t => t.account === account);
        if (type !== 'all') txns = txns.filter(t => t.type === type);
        if (category !== 'all') txns = txns.filter(t => t.category === category);
        if (search) {
            txns = txns.filter(t =>
                (t.note || '').toLowerCase().includes(search) ||
                (t.subCategory || '').toLowerCase().includes(search) ||
                getCategoryName(t.category).toLowerCase().includes(search)
            );
        }

        return txns.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    /* ============================
       CALCULATE BALANCES
    ============================ */
    calculateBalance(accountName) {
        const txns = this.getTransactions();
        let balance = accountName === 'Account 1'
            ? (this.settings.acc1OpeningBalance || 0)
            : (this.settings.acc2OpeningBalance || 0);

        txns.filter(t => t.account === accountName).forEach(t => {
            if (t.type === 'Income') {
                balance += t.amount;
            } else if (t.type === 'Expense') {
                balance -= t.amount;
            } else if (t.type === 'Transfer') {
                if (t.transferDirection === 'out') balance -= t.amount;
                if (t.transferDirection === 'in') balance += t.amount;
            }
        });

        return balance;
    }

    getMonthlyStats(month) {
        const txns = this.getTransactions();
        const monthKey = getMonthKey(month);

        const monthTxns = txns.filter(t => {
            const txnMonth = getMonthKey(new Date(t.date));
            return txnMonth === monthKey;
        });

        let income = 0, expense = 0, transfer = 0;

        monthTxns.forEach(t => {
            if (t.type === 'Income') income += t.amount;
            else if (t.type === 'Expense') expense += t.amount;
            else if (t.type === 'Transfer' && t.transferDirection === 'out') transfer += t.amount;
        });

        return { income, expense, transfer, savings: income - expense, monthTxns };
    }

    /* ============================
       RENDER DASHBOARD
    ============================ */
    renderDashboard() {
        // Month display
        document.getElementById('currentMonth').textContent = getMonthYearStr(this.currentMonth);

        // Account balances
        const acc1Bal = this.calculateBalance('Account 1');
        const acc2Bal = this.calculateBalance('Account 2');
        document.getElementById('acc1Name').textContent = this.settings.acc1Name;
        document.getElementById('acc2Name').textContent = this.settings.acc2Name;
        document.getElementById('acc1Balance').textContent = formatCurrency(acc1Bal);
        document.getElementById('acc2Balance').textContent = formatCurrency(acc2Bal);

        // Monthly stats
        const stats = this.getMonthlyStats(this.currentMonth);
        document.getElementById('totalIncome').textContent = formatCurrency(stats.income);
        document.getElementById('totalExpense').textContent = formatCurrency(stats.expense);
        document.getElementById('totalTransfer').textContent = formatCurrency(stats.transfer);
        document.getElementById('totalSavings').textContent = formatCurrency(stats.savings);

        // Recent transactions (last 5)
        const recentTxns = this.getTransactions()
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5);
        this.renderTransactionList('recentTransactions', recentTxns);

        // Upcoming recurring
        this.renderUpcomingRecurring();

        // Charts
        this.renderCategoryChart(stats.monthTxns);
        this.renderTrendChart();
    }

    /* ============================
       RENDER TRANSACTION LIST
    ============================ */
    renderTransactionList(containerId, txns) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (txns.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-receipt"></i>
                    <p>No transactions yet</p>
                </div>`;
            return;
        }

        container.innerHTML = txns.map(t => {
            const typeClass = t.type.toLowerCase();
            const icon = t.type === 'Income' ? 'fa-arrow-down' :
                         t.type === 'Expense' ? 'fa-arrow-up' :
                         'fa-exchange-alt';
            const amountPrefix = t.type === 'Income' ? '+' :
                                 t.type === 'Expense' ? '-' :
                                 (t.transferDirection === 'in' ? '+' : '-');

            return `
                <div class="txn-item">
                    <div class="txn-icon ${typeClass}"><i class="fas ${icon}"></i></div>
                    <div class="txn-details">
                        <div class="txn-title">${t.subCategory || getCategoryName(t.category)}</div>
                        <div class="txn-meta">
                            <span>${formatDate(t.date)}</span>
                            <span>·</span>
                            <span>${t.account}</span>
                            <span>·</span>
                            <span>${t.paymentMode}</span>
                            ${t.note ? `<span>· ${t.note}</span>` : ''}
                        </div>
                    </div>
                    <div class="txn-amount ${typeClass}">${amountPrefix}${formatCurrency(t.amount)}</div>
                    <div class="txn-actions">
                        <button class="txn-action-btn delete" onclick="app.deleteTransaction('${t.id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }).join('');
    }

    renderTransactions() {
        const txns = this.getFilteredTransactions();
        this.renderTransactionList('allTransactions', txns);
        document.getElementById('noTransactions').style.display = txns.length === 0 ? 'block' : 'none';
    }

    /* ============================
       RENDER TRANSFER VIEW
    ============================ */
    renderTransferView() {
        document.getElementById('transferFromBalance').textContent = formatCurrency(this.calculateBalance('Account 2'));
        document.getElementById('transferToBalance').textContent = formatCurrency(this.calculateBalance('Account 1'));
    }

    /* ============================
       RENDER RECURRING
    ============================ */
    renderRecurring() {
        const items = Storage.get('recurring', []);
        const container = document.getElementById('recurringList');
        const emptyState = document.getElementById('noRecurring');

        if (items.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        container.innerHTML = items.map(item => `
            <div class="recurring-item">
                <div class="rec-info">
                    <div class="rec-name">${item.name}</div>
                    <div class="rec-meta">
                        <span>${getCategoryName(item.category)}</span>
                        <span>·</span>
                        <span>${item.account}</span>
                        <span>·</span>
                        <span>${item.frequency} on ${item.debitDay}${getOrdinal(item.debitDay)}</span>
                    </div>
                </div>
                <div class="rec-amount">${formatCurrency(item.amount)}</div>
                <span class="rec-badge active">Active</span>
                <button class="txn-action-btn delete" onclick="app.deleteRecurring('${item.id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    }

    renderUpcomingRecurring() {
        const items = Storage.get('recurring', []).filter(r => r.isActive);
        const container = document.getElementById('upcomingRecurring');
        const today = new Date().getDate();

        const upcoming = items
            .filter(r => r.debitDay >= today)
            .sort((a, b) => a.debitDay - b.debitDay)
            .slice(0, 5);

        if (upcoming.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>No upcoming debits this month</p></div>`;
            return;
        }

        container.innerHTML = upcoming.map(item => `
            <div class="recurring-item">
                <div class="rec-info">
                    <div class="rec-name">${item.name}</div>
                    <div class="rec-meta">
                        <span>Due on ${item.debitDay}${getOrdinal(item.debitDay)}</span>
                        <span>·</span>
                        <span>${item.account}</span>
                    </div>
                </div>
                <div class="rec-amount">${formatCurrency(item.amount)}</div>
            </div>
        `).join('');
    }

    deleteRecurring(id) {
        this.pendingDeleteId = id;
        this.pendingDeleteType = 'recurring';
        document.getElementById('deleteModal').classList.add('active');
    }

    /* ============================
       RENDER BUDGETS
    ============================ */
    renderBudgets() {
        document.getElementById('budgetCurrentMonth').textContent = getMonthYearStr(this.budgetMonth);

        const monthKey = getMonthKey(this.budgetMonth);
        const budgets = Storage.get('budgets', []).filter(b => b.month === monthKey);
        const container = document.getElementById('budgetList');
        const emptyState = document.getElementById('noBudgets');

        if (budgets.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        // Calculate spent per category for this month
        const txns = this.getTransactions().filter(t => {
            return t.type === 'Expense' && getMonthKey(new Date(t.date)) === monthKey;
        });

        const spentByCategory = {};
        txns.forEach(t => {
            spentByCategory[t.category] = (spentByCategory[t.category] || 0) + t.amount;
        });

        container.innerHTML = budgets.map(budget => {
            const spent = spentByCategory[budget.category] || 0;
            const percent = Math.min((spent / budget.amount) * 100, 100);
            const barClass = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : 'safe';

            return `
                <div class="budget-item">
                    <div class="budget-header">
                        <span class="budget-category">${getCategoryName(budget.category)}</span>
                        <span class="budget-amounts">
                            <span class="spent">${formatCurrency(spent)}</span> / ${formatCurrency(budget.amount)}
                        </span>
                    </div>
                    <div class="budget-bar">
                        <div class="budget-bar-fill ${barClass}" style="width: ${percent}%"></div>
                    </div>
                    <div class="budget-percent" style="display:flex; justify-content:space-between;">
                        <span>${percent.toFixed(0)}% used</span>
                        <button class="txn-action-btn delete" onclick="app.deleteBudget('${budget.id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }).join('');
    }

    deleteBudget(id) {
        this.pendingDeleteId = id;
        this.pendingDeleteType = 'budget';
        document.getElementById('deleteModal').classList.add('active');
    }

    /* ============================
       CHARTS
    ============================ */
    renderCategoryChart(monthTxns) {
        const canvas = document.getElementById('categoryChart');
        const expenses = monthTxns.filter(t => t.type === 'Expense');

        const categoryData = {};
        expenses.forEach(t => {
            const name = getCategoryName(t.category);
            categoryData[name] = (categoryData[name] || 0) + t.amount;
        });

        const labels = Object.keys(categoryData);
        const data = Object.values(categoryData);
        const colors = labels.map((_, i) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]);

        if (this.charts.category) this.charts.category.destroy();

        if (labels.length === 0) {
            canvas.parentElement.querySelector('h3').textContent = 'Spending by Category (No data)';
            return;
        }
        canvas.parentElement.querySelector('h3').textContent = 'Spending by Category';

        this.charts.category = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 16, usePointStyle: true, font: { size: 12 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`
                        }
                    }
                }
            }
        });
    }

    renderTrendChart() {
        const canvas = document.getElementById('trendChart');
        const txns = this.getTransactions();

        // Get last 30 days
        const days = [];
        const dailyData = {};
        const today = new Date(this.currentMonth);
        today.setDate(1);
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

        for (let i = 1; i <= daysInMonth; i++) {
            const d = new Date(today.getFullYear(), today.getMonth(), i);
            const key = d.toISOString().split('T')[0];
            days.push(i);
            dailyData[key] = 0;
        }

        txns.filter(t => t.type === 'Expense').forEach(t => {
            if (dailyData.hasOwnProperty(t.date)) {
                dailyData[t.date] += t.amount;
            }
        });

        if (this.charts.trend) this.charts.trend.destroy();

        this.charts.trend = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: days,
                datasets: [{
                    label: 'Daily Spending',
                    data: Object.values(dailyData),
                    backgroundColor: 'rgba(108, 92, 231, 0.6)',
                    borderColor: '#6c5ce7',
                    borderWidth: 1,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => formatCurrency(ctx.raw)
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (val) => '₹' + val.toLocaleString('en-IN')
                        }
                    }
                }
            }
        });
    }

    /* ============================
       REPORTS
    ============================ */
    renderReports() {
        document.getElementById('reportCurrentMonth').textContent = getMonthYearStr(this.reportMonth);
        const monthKey = getMonthKey(this.reportMonth);
        const txns = this.getTransactions();

        const monthTxns = txns.filter(t => getMonthKey(new Date(t.date)) === monthKey);
        const expenses = monthTxns.filter(t => t.type === 'Expense');

        // Category Breakdown
        this.renderReportCategoryChart(expenses);

        // Income vs Expense Trend (Last 6 months)
        this.renderReportTrendChart(txns);

        // Account-wise Expenses
        this.renderReportAccountChart(expenses);

        // Payment Mode Distribution
        this.renderReportPaymentChart(expenses);

        // Top 5 Expenses
        const top5 = expenses.sort((a, b) => b.amount - a.amount).slice(0, 5);
        this.renderTransactionList('topExpenses', top5);
    }

    renderReportCategoryChart(expenses) {
        const canvas = document.getElementById('reportCategoryChart');
        const categoryData = {};
        expenses.forEach(t => {
            const name = getCategoryName(t.category);
            categoryData[name] = (categoryData[name] || 0) + t.amount;
        });

        const labels = Object.keys(categoryData);
        const data = Object.values(categoryData);
        const colors = labels.map((_, i) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]);

        if (this.charts.reportCategory) this.charts.reportCategory.destroy();

        this.charts.reportCategory = new Chart(canvas, {
            type: 'pie',
            data: {
                labels,
                datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true } },
                    tooltip: {
                        callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)}` }
                    }
                }
            }
        });
    }

    renderReportTrendChart(txns) {
        const canvas = document.getElementById('reportTrendChart');
        const months = [];
        const incomeData = [];
        const expenseData = [];

        for (let i = 5; i >= 0; i--) {
            const d = new Date(this.reportMonth);
            d.setMonth(d.getMonth() - i);
            const key = getMonthKey(d);
            months.push(d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }));

            const monthTxns = txns.filter(t => getMonthKey(new Date(t.date)) === key);
            incomeData.push(monthTxns.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0));
            expenseData.push(monthTxns.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0));
        }

        if (this.charts.reportTrend) this.charts.reportTrend.destroy();

        this.charts.reportTrend = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [
                    {
                        label: 'Income',
                        data: incomeData,
                        backgroundColor: 'rgba(0, 184, 148, 0.7)',
                        borderRadius: 4,
                    },
                    {
                        label: 'Expenses',
                        data: expenseData,
                        backgroundColor: 'rgba(225, 112, 85, 0.7)',
                        borderRadius: 4,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: val => '₹' + val.toLocaleString('en-IN') }
                    }
                }
            }
        });
    }

    renderReportAccountChart(expenses) {
        const canvas = document.getElementById('reportAccountChart');
        const acc1 = expenses.filter(t => t.account === 'Account 1').reduce((s, t) => s + t.amount, 0);
        const acc2 = expenses.filter(t => t.account === 'Account 2').reduce((s, t) => s + t.amount, 0);

        if (this.charts.reportAccount) this.charts.reportAccount.destroy();

        this.charts.reportAccount = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: [this.settings.acc1Name, this.settings.acc2Name],
                datasets: [{
                    data: [acc1, acc2],
                    backgroundColor: ['#6c5ce7', '#00b894'],
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } },
                    tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)}` } }
                }
            }
        });
    }

    renderReportPaymentChart(expenses) {
        const canvas = document.getElementById('reportPaymentChart');
        const modeData = {};
        expenses.forEach(t => {
            modeData[t.paymentMode] = (modeData[t.paymentMode] || 0) + t.amount;
        });

        if (this.charts.reportPayment) this.charts.reportPayment.destroy();

        this.charts.reportPayment = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: Object.keys(modeData),
                datasets: [{
                    data: Object.values(modeData),
                    backgroundColor: ['#6c5ce7', '#00b894', '#e17055', '#fdcb6e', '#74b9ff'],
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } },
                    tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)}` } }
                }
            }
        });
    }

    /* ============================
       TOAST NOTIFICATION
    ============================ */
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

/* --- Utility --- */
function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

// Global reference for inline onclick handlers
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new ExpenseApp();
    app.init();
});
