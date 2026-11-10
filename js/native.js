/* ========================================
   NATIVE BRIDGE - Android-only features (via Capacitor)
   "Share → MoneyBook" for bank SMS, local reminder notifications,
   back button and app-resume handling. In a browser every method is a no-op.
   The app has no SMS or notification-reading permission: it only sees text the user shares.
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
            if (isActive && Store.userId) { Store.flush(); app.loadCaptures(); app.refreshUpdate(); }
        });
        App.addListener('backButton', () => {
            if (document.getElementById('sheetOverlay').classList.contains('show')) app.closeSheet();
            else if (!TOP_VIEWS.includes(app.view)) app.navigate('more');
            else if (app.view !== 'home') app.navigate('home');
            else App.minimizeApp();
        });
        // Fired by the Android side when a message is shared to MoneyBook while the app is open
        this.plugin('MoneyCapture').addListener('captured', () => app.loadCaptures());
        this.plugin('MoneyCapture').addListener('scanned', () => app.checkSharedScan());
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

    /* ---------- shared messages ---------- */
    async getCaptures() {
        if (!this.isNative) return [];
        try { return (await this.plugin('MoneyCapture').getPending()).items || []; } catch { return []; }
    },

    async removeCaptures(ids) {
        if (!this.isNative || !ids.length) return;
        try { await this.plugin('MoneyCapture').remove({ ids }); } catch { /* ignore */ }
    },

    /** Clipboard text, read only when the user taps "Paste SMS". */
    async readClipboard() {
        try {
            if (this.isNative) return (await this.plugin('Clipboard').read()).value || '';
            return await navigator.clipboard.readText();
        } catch {
            return '';
        }
    },

    /** On-device text recognition of a picked image (Android only). Returns { text, blocks }. */
    async scanImage(dataUrl) {
        if (!this.isNative) throw new Error('Screenshot scanning works in the Android app');
        return this.plugin('MoneyCapture').scanImage({ data: dataUrl });
    },

    /** Text of a screenshot shared to MoneyBook (held in memory only, cleared once read). */
    async takeScan() {
        if (!this.isNative) return null;
        try { return await this.plugin('MoneyCapture').takeScan(); } catch { return null; }
    },

    /** Id of the message just shared to MoneyBook (cleared once read), or ''. */
    async takeShared() {
        if (!this.isNative) return '';
        try { return (await this.plugin('MoneyCapture').takeShared()).id || ''; } catch { return ''; }
    },

    async status() {
        if (!this.isNative) return { notifications: false };
        const perm = await this.plugin('LocalNotifications').checkPermissions().catch(() => ({}));
        return { notifications: perm.display === 'granted' };
    },

    async requestNotificationPermission() {
        if (!this.isNative) return;
        await this.plugin('LocalNotifications').requestPermissions().catch(() => {});
    },

    /* ---------- fingerprint / face unlock ---------- */
    BIO_KEY: id => `mb_bio_${id}`,

    /** { available, label } for the phone's biometric unlock. */
    async biometry() {
        if (!this.isNative) return { available: false };
        try {
            const r = await this.plugin('BiometricAuthNative').checkBiometry();
            const face = /face/i.test(String(r.biometryType)) || (r.biometryTypes || []).some(t => /face/i.test(String(t)));
            return { available: !!r.isAvailable, label: face ? 'face' : 'fingerprint' };
        } catch {
            return { available: false };
        }
    },

    /** Shows the system fingerprint / face prompt; resolves true on success, false if cancelled or failed. */
    async biometricCheck(subtitle) {
        try {
            await this.plugin('BiometricAuthNative').internalAuthenticate({
                reason: subtitle, androidTitle: 'Unlock MoneyBook', androidSubtitle: subtitle,
                cancelTitle: 'Use password', allowDeviceCredential: true, androidConfirmationRequired: false,
            });
            return true;
        } catch {
            return false;
        }
    },

    bioEnabled(id) {
        try { return this.isNative && localStorage.getItem(this.BIO_KEY(id)) === '1'; } catch { return false; }
    },

    setBio(id, on) {
        try { if (on) localStorage.setItem(this.BIO_KEY(id), '1'); else localStorage.removeItem(this.BIO_KEY(id)); } catch { /* ignore */ }
    },

    /* ---------- app updates (APK is installed outside the Play Store) ---------- */
    UPDATE_KEY: 'mb_update',
    UPDATE_EVERY_MS: 6 * 60 * 60 * 1000,

    /** Installed version, e.g. { version: '2.1.7', build: '7' }. */
    async appInfo() {
        if (!this.isNative) return null;
        try { return await this.plugin('App').getInfo(); } catch { return null; }
    },

    /**
     * Looks for a newer release on GitHub (at most every 6 hours unless forced).
     * Release tags are v2.1.<build>, and the build number is the APK's versionCode.
     * Returns { version, notes, url } or null.
     */
    async checkForUpdate(force = false) {
        if (!this.isNative || !APP_CONFIG.updateRepo) return null;
        const info = await this.appInfo();
        if (!info) return null;
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(this.UPDATE_KEY)); } catch { /* none */ }
        if (!force && cached && Date.now() - cached.checkedAt < this.UPDATE_EVERY_MS) {
            return cached.build > Number(info.build) ? cached : null;
        }
        try {
            const res = await fetch(`https://api.github.com/repos/${APP_CONFIG.updateRepo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
            if (!res.ok) return null;
            const rel = await res.json();
            const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name));
            const build = Number(String(rel.tag_name || '').split('.').pop());
            const notes = String(rel.body || '').split('\n').map(l => l.replace(/^[#*\s-]+|\*\*/g, '').trim())
                .find(l => l && !/^(download|built from)/i.test(l)) || '';
            const latest = { version: String(rel.tag_name).replace(/^v/, ''), build, notes: notes.replace(/^What's new:\s*/i, ''), url: apk?.browser_download_url || rel.html_url, checkedAt: Date.now() };
            localStorage.setItem(this.UPDATE_KEY, JSON.stringify(latest));
            return build > Number(info.build) ? latest : null;
        } catch {
            return null;
        }
    },

    openUpdate(url) {
        // Opens the APK download in the phone's browser; Android's installer takes it from there
        this.plugin('AppLauncher').openUrl({ url }).catch(() => { window.location.href = url; });
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
                body: 'Share today\'s bank SMS to MoneyBook, or add cash spends in a few seconds.',
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
