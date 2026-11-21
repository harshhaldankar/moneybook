// Tests for js/statement.js: bank statement / passbook CSV files in the shapes Indian banks export.
// Runs in Node (no browser): the CSV path never needs the Excel library.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, TextDecoder, Uint8Array, window: {}, document: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/statement.js'), 'utf8') + '\nthis.Statement = Statement;', ctx);
const Statement = ctx.Statement;

/** Fake browser File from a string (or raw bytes). */
const file = (name, content, type = '') => ({
    name, type,
    arrayBuffer: async () => {
        const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    },
});
const summary = rows => Array.from(rows, r => `${r.date} ${r.type === 'Income' ? '+' : '-'}${r.amount}`);

const tests = {
    // Central Bank of India style, with account details above the header
    cbiPassbookWithPreamble: async () => {
        const csv = [
            'Account Statement,,,,,,,',
            'Account No.,XXXXXXX1386,,,,,,',
            'Period,01/11/2026 to 10/11/2026,,,,,,',
            '',
            'Post Date,Value Date,Branch Code,Cheque Number,Account Description,Debit,Credit,Balance',
            '08/11/2026,08/11/2026,1234,,UPI/CR/667832906937/VAISHALI MAHENDRA HALDAN,,"1,000.00","1,427.18"',
            '08/11/2026,08/11/2026,1234,,UPI/DR/667889927097/SHOP,150.00,,"1,277.18"',
            '10/11/2026,10/11/2026,1234,,UPI/DR/668019419482/GAURESH,120.00,,837.18',
        ].join('\r\n');
        const r = await Statement.read(file('passbook.csv', csv, 'text/csv'));
        assert.deepStrictEqual(summary(r.rows), ['2026-11-08 +1000', '2026-11-08 -150', '2026-11-10 -120']);
    },

    // SBI saves tab-separated text with an .xls name
    sbiTabTextNamedXls: async () => {
        const txt = 'Txn Date\tValue Date\tDescription\tRef No./Cheque No.\tDebit\tCredit\tBalance\n'
            + '8 Nov 2026\t8 Nov 2026\tTO TRANSFER-UPI/DR/431234567891/ZOMATO\tTRANSFER TO 123\t350.00\t\t4,650.00\n'
            + '9 Nov 2026\t9 Nov 2026\tBY TRANSFER-NEFT ACME\t\t\t85,000.00\t89,650.00\n';
        const r = await Statement.read(file('statement.xls', txt, 'application/vnd.ms-excel'));
        assert.deepStrictEqual(summary(r.rows), ['2026-11-08 -350', '2026-11-09 +85000']);
    },

    // Some exports are UTF-16 with a byte-order mark
    utf16File: async () => {
        const csv = 'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/11/26,SALARY ACME,,"75,000.00","80,000.00"\n03/11/26,RENT,"18,500.00",,"61,500.00"\n';
        const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]);
        const r = await Statement.read(file('hdfc.csv', bytes));
        assert.deepStrictEqual(summary(r.rows), ['2026-11-01 +75000', '2026-11-03 -18500']);
    },

    // Semicolon-separated, single Amount column with Dr/Cr
    semicolonAmountDrCr: async () => {
        const csv = 'Transaction Date;Particulars;Amount;Dr / Cr;Balance\n2026-11-05;BIGBASKET;2,340.00;DR;10,000.00\n2026-11-06;INTEREST;12.50;CR;10,012.50\n';
        const r = await Statement.read(file('kotak.csv', csv));
        assert.deepStrictEqual(summary(r.rows), ['2026-11-05 -2340', '2026-11-06 +12.5']);
    },

    // Passbook with only Amount + Balance, newest first: direction comes from the balance
    amountAndBalanceNewestFirst: async () => {
        const csv = 'Date,Remarks,Amount,Balance\n10-11-2026,UPI GAURESH,120.00,837.18\n08-11-2026,UPI SHOP,150.00,957.18\n08-11-2026,UPI VAISHALI,1000.00,1107.18\n07-11-2026,OPENING,0,107.18\n';
        const r = await Statement.read(file('passbook.csv', csv));
        assert.deepStrictEqual(summary(r.rows), ['2026-11-10 -120', '2026-11-08 -150', '2026-11-08 +1000']);
    },

    // Same, oldest first
    amountAndBalanceOldestFirst: async () => {
        const csv = 'Date,Remarks,Amount,Balance\n07-11-2026,OPENING,0,107.18\n08-11-2026,UPI VAISHALI,1000.00,1107.18\n08-11-2026,UPI SHOP,150.00,957.18\n';
        const r = await Statement.read(file('passbook.csv', csv));
        assert.deepStrictEqual(summary(r.rows), ['2026-11-08 +1000', '2026-11-08 -150']);
    },

    // No usable header: the error names what the file starts with, so it can be fixed
    unknownLayoutExplainsItself: async () => {
        await assert.rejects(
            Statement.read(file('odd.csv', 'Foo,Bar,Baz\n1,2,3\n')),
            err => /header row/.test(err.message) && /Foo \| Bar \| Baz/.test(err.message));
    },

    quotedFieldsWithCommasAndNewlines: async () => {
        const grid = Statement.parseText('a,"b, c","d ""q"""\n1,"two\nlines",3\n');
        assert.deepStrictEqual(Array.from(grid[0]), ['a', 'b, c', 'd "q"']);
        assert.deepStrictEqual(Array.from(grid[1]), ['1', 'two\nlines', '3']);
    },
};

(async () => {
    let pass = 0, fail = 0;
    for (const [name, fn] of Object.entries(tests)) {
        try { await fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
    }
    console.log(`statement: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
