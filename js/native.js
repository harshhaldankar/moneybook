/* ========================================
   NATIVE BRIDGE - Android-only features (via Capacitor)
   Auto-capture from bank SMS / UPI apps, local reminder notifications,
   back button and app-resume handling. In a browser every method is a no-op.
   ======================================== */

const NOTIF = { DAILY: 1, MONTHLY: 2, DUE_BASE: 100, DUE_MAX: 199, BUDGET_BASE: 300, TEST: 999 };

const Native = {
    isNative: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
    app: null,
    scheduleTimer: null,

    plugin(name) {
        if (!this.isNative) return null;
        return window.Capacitor.Plugins[name] || window.Capacitor.registerPlugin(name);
    },

    async init(app) {
        this.app = app;
        if (!this.isNative) return;
        document.body.classList.add('native');
        const App = this.plugin('App');
        App.addListener('appStateChange', ({ isActive }) => {
            if (isActive && Store.userId) { Store.flush(); app.loadCaptures(); }
        });
        App.addListener('backButton', () => {
            if (document.getElementById('sheetOverlay').classList.contains('show')) app.closeSheet();
            else if (!TOP_VIEWS.includes(app.view)) app.navigate('more');
            else if (app.view !== 'home') app.navigate('home');
            else App.minimizeApp();
        });
        // Fired by the Android side when a bank SMS / UPI alert is captured while the app is open
        this.plugin('MoneyCapture').addListener('captured', () => app.loadCaptures());
        try {
            await this.plugin('LocalNotifications').createChannel({ id: 'reminders', name: 'Reminders', description: 'Daily and auto-debit reminders, budget alerts', importance: 4 });
        } catch { /* channel already exists */ }
    },

    async onLogin(data) {
        if (!this.isNative) return;
        await this.requestNotificationPermission();
        this.scheduleReminders(data);
        this.app.loadCaptures();
    },

    /* ---------- auto-capture ---------- */
    async getCaptures() {
        if (!this.isNative) return [];
        try { return (await this.plugin('MoneyCapture').getPending()).items || []; } catch { return []; }
    },

    async removeCaptures(ids) {
        if (!this.isNative || !ids.length) return;
        try { await this.plugin('MoneyCapture').remove({ ids }); } catch { /* ignore */ }
    },

    async status() {
        if (!this.isNative) return { sms: false, upi: false, notifications: false };
        const [cap, perm] = await Promise.all([
            this.plugin('MoneyCapture').status().catch(() => ({})),
            this.plugin('LocalNotifications').checkPermissions().catch(() => ({})),
        ]);
        return { sms: !!cap.sms, upi: !!cap.upi, notifications: perm.display === 'granted' };
    },

    async enableSms() {
        if (!this.isNative) return;
        await this.plugin('MoneyCapture').requestSmsPermission().catch(() => {});
    },

    openNotificationAccess() {
        if (this.isNative) this.plugin('MoneyCapture').openNotificationAccess().catch(() => {});
    },

    async requestNotificationPermission() {
        if (!this.isNative) return;
        await this.plugin('LocalNotifications').requestPermissions().catch(() => {});
    },

    /* ---------- reminders ---------- */
    notify(list) {
        return this.plugin('LocalNotifications').schedule({
            notifications: list.map(n => ({ channelId: 'reminders', smallIcon: 'ic_stat_moneybook', ...n })),
        }).catch(() => {});
    },

    /** Rebuild every scheduled reminder from the current data (debounced). */
    scheduleReminders(data) {
        if (!this.isNative || !data) return;
        clearTimeout(this.scheduleTimer);
        this.scheduleTimer = setTimeout(() => this.doSchedule(data), 800);
    },

    async doSchedule(data) {
        const LN = this.plugin('LocalNotifications');
        const s = data.settings;
        try {
            const pending = await LN.getPending();
            const ours = (pending.notifications || []).filter(n => n.id < NOTIF.BUDGET_BASE);
            if (ours.length) await LN.cancel({ notifications: ours.map(n => ({ id: n.id })) });
        } catch { /* nothing scheduled */ }

        const list = [];
        if (s.dailyReminder) {
            const [hour, minute] = String(s.reminderTime || '21:00').split(':').map(Number);
            list.push({
                id: NOTIF.DAILY, title: 'Any cash spends today?',
                body: 'UPI and card payments are captured automatically. Add cash spends in a few seconds.',
                schedule: { on: { hour, minute }, allowWhileIdle: true },
            });
        }

        if (s.dueReminders) {
            const now = new Date();
            data.recurring.filter(r => r.isActive).forEach((r, i) => {
                if (i > NOTIF.DUE_MAX - NOTIF.DUE_BASE) return;
                const due = this.app.nextDue(r);
                const at = new Date(due + 'T09:00:00');
                at.setDate(at.getDate() - 1);
                if (at <= now) return;
                const acc = data.accounts.find(a => a.id === r.accountId);
                list.push({
                    id: NOTIF.DUE_BASE + i,
                    title: `Tomorrow: ${r.name} ${formatCurrency(r.amount)}`,
                    body: `${acc ? `From ${acc.name}. ` : ''}${r.autoPost ? 'It will be recorded automatically.' : 'Tap Paid in MoneyBook once it\'s debited.'}`,
                    schedule: { at, allowWhileIdle: true },
                });
            });
        }

        // 1st of next month: nudge to look at the savings summary
        const [y, m] = currentMonthKey().split('-').map(Number);
        list.push({
            id: NOTIF.MONTHLY, title: 'Your monthly savings summary is ready',
            body: `See how much you saved in ${monthLabel(currentMonthKey())} and what carries forward.`,
            schedule: { at: new Date(y, m, 1, 10, 0), allowWhileIdle: true },
        });

        if (list.length) await this.notify(list);
    },

    /** Notify once when a budget crosses 80% and again at 100%. */
    checkBudgetAlerts(data) {
        if (!this.isNative || !data.settings.budgetAlerts) return;
        const month = currentMonthKey();
        const spend = Object.fromEntries(Calc.categorySpend(data, month).map(c => [c.category, c.amount]));
        const alerted = { ...(data.settings.budgetAlerted || {}) };
        const list = [];
        data.budgets.filter(b => b.month === month).forEach((b, i) => {
            const pct = (spend[b.category] || 0) / b.amount * 100;
            const level = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
            const key = `${month}:${b.category}`;
            if (!level || (alerted[key] || 0) >= level) return;
            alerted[key] = level;
            const name = getCategory(b.category).name;
            list.push({
                id: NOTIF.BUDGET_BASE + i,
                title: level === 100 ? `${name} budget exceeded` : `${name} budget 80% used`,
                body: `${formatCurrency(spend[b.category] || 0)} of ${formatCurrency(b.amount)} spent this month.`,
                schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
            });
        });
        if (!list.length) return;
        data.settings.budgetAlerted = alerted;
        Store.save();
        this.notify(list);
    },

    async testNotification() {
        if (!this.isNative) return;
        await this.requestNotificationPermission();
        await this.notify([{ id: NOTIF.TEST, title: 'MoneyBook notifications work 🎉', body: 'You\'ll get reminders like this one.', schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true } }]);
        this.app.toast('Test notification in 2 seconds');
    },
};
