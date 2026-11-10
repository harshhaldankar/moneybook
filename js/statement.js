/* ========================================
   BANK STATEMENT IMPORT - CSV / Excel statements from net banking
   Finds the header row (date, narration, withdrawal/deposit or amount + Dr/Cr),
   turns each row into a transaction draft, and pulls the merchant out of the narration.
   The Excel reader (SheetJS) loads only when someone imports a statement.
   ======================================== */

const Statement = {
    LIB_URL: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    MAX_ROWS: 1500,

    async loadLib() {
        if (window.XLSX) return;
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = this.LIB_URL;
            s.onload = resolve;
            s.onerror = () => reject(new Error('Couldn\'t load the statement reader. Check your internet connection.'));
            document.head.appendChild(s);
        });
    },

    /** Reads a .csv / .xls / .xlsx file into { rows: [...], from, to } or throws with a friendly message. */
    async read(file) {
        await this.loadLib();
        const isText = /\.(csv|txt)$/i.test(file.name) || /text|csv/.test(file.type);
        // Text is read as plain strings so "01/11/26" stays day-first (Indian format)
        const wb = isText
            ? XLSX.read(await file.text(), { type: 'string', raw: true })
            : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        for (const name of wb.SheetNames) {
            const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
            const parsed = this.parseGrid(grid);
            if (parsed.rows.length) return parsed;
        }
        throw new Error('Couldn\'t find transactions in that file. Download the statement as Excel or CSV from net banking.');
    },

    findColumns(cells) {
        const find = (re, not) => cells.findIndex(c => re.test(c) && !(not && not.test(c)));
        const cols = {
            date: find(/^(txn|tran|transaction|posting|value)?\s*\.?\s*date$|^date\b/, /value/),
            desc: find(/narration|description|particulars|remarks|details/),
            debit: find(/withdraw|withdrawl|debit|^dr\.?$|paid out/, /credit|\/|balance/),
            credit: find(/deposit|credit|^cr\.?$|paid in/, /debit|\/|balance/),
            amount: find(/^(txn |transaction )?amount|amount \(/, /balance/),
            type: find(/dr\s*\/\s*cr|cr\s*\/\s*dr|^type$|debit\s*\/\s*credit/),
        };
        if (cols.date < 0) cols.date = find(/date/);
        return cols;
    },

    parseGrid(grid) {
        let header = -1, cols = null;
        for (let i = 0; i < Math.min(grid.length, 80); i++) {
            const cells = grid[i].map(c => String(c).toLowerCase().replace(/\s+/g, ' ').trim());
            const c = this.findColumns(cells);
            if (c.date >= 0 && c.desc >= 0 && ((c.debit >= 0 && c.credit >= 0) || c.amount >= 0)) { header = i; cols = c; break; }
        }
        if (header < 0) return { rows: [] };

        const rows = [];
        for (const r of grid.slice(header + 1)) {
            if (rows.length >= this.MAX_ROWS) break;
            const date = this.parseDate(r[cols.date]);
            const desc = String(r[cols.desc] ?? '').replace(/\s+/g, ' ').trim();
            if (!date || !desc) continue;
            let amount = 0, type = null;
            if (cols.debit >= 0 && cols.credit >= 0) {
                const dr = this.num(r[cols.debit]), cr = this.num(r[cols.credit]);
                if (dr > 0) { amount = dr; type = 'Expense'; } else if (cr > 0) { amount = cr; type = 'Income'; }
            } else {
                const raw = String(r[cols.amount] ?? '');
                amount = Math.abs(this.num(raw));
                const t = String(cols.type >= 0 ? r[cols.type] : raw).toLowerCase();
                type = /\bcr|credit|deposit/.test(t) ? 'Income' : /\bdr|debit|withdraw|-/.test(t) || this.num(raw) < 0 ? 'Expense' : null;
            }
            if (!(amount > 0) || !type) continue;
            rows.push({ date, desc, amount: Math.round(amount * 100) / 100, type });
        }
        const dates = rows.map(r => r.date).sort();
        return { rows, from: dates[0], to: dates[dates.length - 1] };
    },

    num(v) {
        if (typeof v === 'number') return v;
        const s = String(v ?? '').replace(/[,₹\s]|inr|rs\.?/gi, '').replace(/(cr|dr)$/i, '');
        const n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    },

    /** Day-first dates as banks print them: 01/11/26, 01-11-2026, 01 Nov 2026, 01-Nov-26, 2026-11-01, or a real Date. */
    parseDate(v) {
        const pad = n => String(n).padStart(2, '0');
        const ok = (y, m, d) => {
            if (y < 100) y += 2000;
            const dt = new Date(y, m - 1, d);
            return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d && y > 2000 && y < 2100 ? `${y}-${pad(m)}-${pad(d)}` : null;
        };
        if (v instanceof Date && !isNaN(v)) return ok(v.getFullYear(), v.getMonth() + 1, v.getDate());
        if (typeof v === 'number' && v > 30000 && v < 80000) {      // Excel serial date
            const dt = new Date(Math.round((v - 25569) * 864e5));
            return ok(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        }
        const s = String(v ?? '').trim();
        const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        let m;
        if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return ok(+m[1], +m[2], +m[3]);
        if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(s))) return ok(+m[3], +m[2], +m[1]);
        if ((m = /^(\d{1,2})[\s/-]*([a-z]{3})[a-z]*[\s/,-]*(\d{2,4})\b/i.exec(s)) && months[m[2].toLowerCase()]) return ok(+m[3], months[m[2].toLowerCase()], +m[1]);
        return null;
    },

    /** "UPI-SWIGGY-swiggy@icici-ICIC0000103-431234567890-Payment" → "Swiggy". */
    merchantFrom(desc) {
        // Banking code words, and bank codes (IFSC prefixes) that appear between slashes
        const codeWord = /^(upi|neft|imps|rtgs|ach|nach|ecs|pos|ecom|atm|dr|cr|d|c|p2m|p2a|mb|ib|inb|by|to|from|transfer|trf|ft|bil|onl|vps|ref|payment|txn|tpt|inft|chq|cash|wdl|mmt|funds|sent|using|si|mandate|yesb|sbin|icic|hdfc|utib|kkbk|punb|barb|cnrb|idib|ubin|idfb|indb|fdrl|airp|pytm)$/i;
        const tokens = desc.split(/[/|\\:-]+|\s{2,}/)
            .map(t => t.split(/\s+/).filter(w => !codeWord.test(w) && !/^[\dx*]+$/i.test(w)).join(' ').trim())
            .filter(t => /[a-z]{2}/i.test(t) && !t.includes('@') && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(t));
        const name = (tokens[0] || desc).replace(/\s+/g, ' ').slice(0, 30).trim();
        return name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : name;
    },

    modeFrom(desc) {
        const d = desc.toLowerCase();
        if (/\bupi\b/.test(d)) return 'UPI';
        if (/\batm\b|cash wdl|cash withdrawal/.test(d)) return 'Cash';
        if (/\bpos\b|\becom\b|card/.test(d)) return 'Card';
        if (/\b(nach|ach|ecs|si|auto ?debit|mandate)\b/.test(d)) return 'Auto-Debit';
        if (/\b(neft|imps|rtgs|ib|inb|mb)\b/.test(d)) return 'Net Banking';
        return 'UPI';
    },

    /** Turn parsed rows into drafts for one account, flagging duplicates and rows before the opening date. */
    toDrafts(data, accountId, rows) {
        const account = data.accounts.find(a => a.id === accountId);
        const cash = data.accounts.find(a => !a.archived && a.type === 'Cash / Wallet' && a.id !== accountId);
        const existing = data.transactions.filter(t => t.accountId === accountId || t.toAccountId === accountId);
        const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 864e5;
        return rows.map((r, i) => {
            const merchant = this.merchantFrom(r.desc);
            const atm = /\batm\b|cash wdl|cash withdrawal/i.test(r.desc) && r.type === 'Expense';
            const guess = Capture.guessCategory(data, `${merchant} ${r.desc}`, r.type);
            const draft = {
                key: `row${i}`, date: r.date, amount: r.amount, desc: r.desc,
                type: atm && cash ? 'Transfer' : r.type,
                toAccountId: atm && cash ? cash.id : '',
                category: atm && cash ? 'transfer' : (guess.category || (r.type === 'Income' ? 'other_income' : 'misc')),
                note: atm ? 'ATM withdrawal' : merchant,
                paymentMode: this.modeFrom(r.desc),
            };
            draft.duplicate = existing.some(t => Math.abs(t.amount - r.amount) < 0.01 && near(t.date, r.date)
                && (t.type === draft.type || (t.type === 'Transfer' && draft.type !== 'Income')));
            draft.beforeOpening = !!account && r.date < account.openingDate;
            draft.selected = !draft.duplicate && !draft.beforeOpening;
            return draft;
        });
    },
};
