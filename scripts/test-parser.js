// Tests for js/parser.js — the same cases as android/app/src/test/.../TxnParserTest.java
const assert = require('assert');
const TxnParser = require('../js/parser.js');

const ok = (sms, type, amount, last4, merchant, mode) => {
    const t = TxnParser.parse(sms);
    assert.ok(t, `should parse: ${sms}`);
    assert.strictEqual(t.type, type, `type: ${sms}`);
    assert.ok(Math.abs(t.amount - amount) < 0.001, `amount: ${sms} → ${t.amount}`);
    assert.strictEqual(t.last4, last4, `last4: ${sms}`);
    assert.strictEqual(t.merchant, merchant, `merchant: ${sms}`);
    if (mode) assert.strictEqual(t.mode, mode, `mode: ${sms}`);
};

const tests = {
    hdfcUpiSent: () => ok('Sent Rs.249.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 08/11/26\nRef 431234567890\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808', 'debit', 249, '4521', 'SWIGGY', 'UPI'),
    sbiUpiWithoutRupeeSymbol: () => ok('Dear UPI user A/C X0123 debited by 350.0 on date 08Nov26 trf to ZOMATO Refno 431234567891. If not u? call 1800111109. -SBI', 'debit', 350, '0123', 'ZOMATO', 'UPI'),
    iciciCardSpend: () => ok('INR 1,250.00 spent using ICICI Bank Card XX9012 on 08-Nov-26 on AMAZON PAY IN. Avl Limit: INR 98,750.00. If not you, call 1800 2662/SMS BLOCK 9012 to 9215676766', 'debit', 1250, '9012', 'AMAZON PAY IN', 'Card'),
    axisUpiPath: () => ok('INR 500.00 debited\nA/c no. XX3456\n08-11-26, 10:15:22\nUPI/P2M/431234567892/BLINKIT\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank', 'debit', 500, '3456', 'BLINKIT', 'UPI'),
    kotakToVpa: () => ok('Sent Rs.120.00 from Kotak Bank AC X7788 to rapido@ybl on 08-11-26.UPI Ref 431234567893. Not you, https://kotak.com/KBANKT/Fraud', 'debit', 120, '7788', 'rapido', 'UPI'),
    atmWithdrawal: () => ok('Rs.2000 withdrawn from A/c XX4521 at ATM HDFC0001 on 08-11-26. Avl bal Rs 38,000', 'debit', 2000, '4521', 'ATM HDFC0001', 'Cash'),
    neftDebit: () => ok('Your A/c XX4521 is debited for Rs.15,000.00 on 08-11-26 by NEFT transfer to RAHUL SHARMA. Avl Bal Rs 1,20,000', 'debit', 15000, '4521', 'RAHUL SHARMA', 'Net Banking'),
    salaryCredit: () => ok('Rs.75,000.00 credited to HDFC Bank A/c XX4521 on 01-11-26 by NEFT from ACME TECHNOLOGIES PVT LTD. Avl bal Rs.1,40,000.00', 'credit', 75000, '4521', 'ACME TECHNOLOGIES PVT LTD', 'Net Banking'),
    sbiUpiCredit: () => ok('Dear SBI User, your A/c X0123-credited by Rs.500 on 08Nov26 transfer from PRIYA S Ref No 431234567894 -SBI', 'credit', 500, '0123', 'PRIYA S'),
    refundCredit: () => ok('Refund of Rs.499.00 credited to your A/c XX4521 for AMAZON order 402-1234', 'credit', 499, '4521', ''),
    gpayPaid: () => ok('₹250 paid to Swiggy', 'debit', 250, '', 'Swiggy'),
    phonepePaid: () => ok('Paid ₹45 to Chai Point', 'debit', 45, '', 'Chai Point'),
    gpayReceived: () => ok('Rahul Verma paid you ₹100', 'credit', 100, '', 'Rahul Verma'),
    gpayReceiptScreenshot: () => ok('To Swiggy\n₹250\nCompleted\n10 Nov 2026, 8:15 pm\nUPI transaction ID\n431234567895\nTo: SWIGGY\nswiggy@icici\nFrom: HARSH HALDANKAR (HDFC Bank)\nXXXX4521', 'debit', 250, '4521', 'Swiggy', 'UPI'),
    phonepeReceivedReceipt: () => ok('Received from\nRahul Verma\n₹1,200\nTransaction Successful\nUTR: 431234567896\nCredited to\nXXXXXX0123', 'credit', 1200, '0123', 'Rahul Verma'),
    cboiCreditWithCompactDate: () => {
        ok('A/c XX1386 credited by Rs. 1000.00 on 08112026 via UPI from VAISHALI MAHENDRA HALDAN via Ref No. 667832906937. -CBoI', 'credit', 1000, '1386', 'VAISHALI MAHENDRA HALDAN', 'UPI');
        assert.strictEqual(TxnParser.parse('A/c XX1386 credited by Rs. 1000.00 on 08112026 via UPI from VAISHALI MAHENDRA HALDAN via Ref No. 667832906937. -CBoI').ref, '667832906937');
    },
    cboiDebitWithBalance: () => {
        ok('A/c XX1386 debited by Rs. 120.00 via UPI with Ref No. 668019419482 Total Bal Rs. 837.18 Clr Bal Rs. 837.18. -CBoI', 'debit', 120, '1386', '', 'UPI');
        assert.strictEqual(TxnParser.parse('A/c XX1386 debited by Rs. 120.00 via UPI with Ref No. 668019419482 Total Bal Rs. 837.18 Clr Bal Rs. 837.18. -CBoI').ref, '668019419482');
    },
    gpayReceiptPicksBankDigitsNotPayeeVpa: () => {
        const r = 'G\nTo Gauresh Mahendra Haldankar\n₹120\nPay again\nCompleted\n10 Nov 2026, 9:35pm\nCentral Bank of India 1386\nPayment started\nPayment completed\nUPI transaction ID\n668019419482\nTo: Gauresh Mahendra Haldankar\n••••••9272@fam on FamApp by Trio\nFrom: Mr HARSH MAHENDRA HALDANKAR\n(Central Bank of India)\n••••ar95@okicici on Google Pay\nGoogle transaction ID\nCICAgPjtqtHMbA';
        ok(r, 'debit', 120, '1386', 'Gauresh Mahendra Haldankar', 'UPI');
        assert.strictEqual(TxnParser.parse(r).ref, '668019419482');
    },
    bankBalance: () => {
        assert.strictEqual(TxnParser.parse('A/c XX1386 debited by Rs. 120.00 via UPI with Ref No. 668019419482 Total Bal Rs. 837.18 Clr Bal Rs. 837.18. -CBoI').balance, 837.18);
        assert.strictEqual(TxnParser.parse('Rs.2000 withdrawn from A/c XX4521 at ATM HDFC0001 on 08-11-26. Avl bal Rs 38,000').balance, 38000);
        assert.strictEqual(TxnParser.parse('Rs.75,000.00 credited to HDFC Bank A/c XX4521 on 01-11-26 by NEFT from ACME TECHNOLOGIES PVT LTD. Avl bal Rs.1,40,000.00').balance, 140000);
        assert.strictEqual(TxnParser.parse('INR 1,250.00 spent using ICICI Bank Card XX9012 on 08-Nov-26 on AMAZON PAY IN. Avl Limit: INR 98,750.00.').balance, null);
    },
    balanceOnlyFragmentIsNotATransaction: () => assert.strictEqual(TxnParser.parse('via UPI with Ref No. 631147348109 Total Bal Rs. 747.18 Clr Bal Rs. 747.18. -CBoI'), null),
    rejectsOtp: () => {
        assert.strictEqual(TxnParser.parse('123456 is your OTP for txn of Rs.2,500 at AMAZON on HDFC Bank Card XX9012. Valid for 10 mins. Do not share OTP'), null);
        assert.strictEqual(TxnParser.parse('Use verification code 4455 to log in to NetBanking'), null);
        assert.strictEqual(TxnParser.parse('Your One Time Password for Rs 999 payment is 778812'), null);
        assert.ok(TxnParser.isSensitive('Never share your UPI PIN with anyone'));
    },
    rejectsRemindersOffersAndFailures: () => {
        for (const sms of [
            'Your HDFC Credit Card bill of Rs.12,345 is due on 15-11-26. Min amt due Rs 617',
            'Get pre-approved personal loan of Rs.5,00,000. Apply now',
            'Your UPI txn of Rs.300 to ZOMATO failed. Amount if debited will be refunded',
            'PRIYA has requested Rs.200 from you on PhonePe',
            'Rs.649 will be debited from your A/c XX4521 on 15-11-26 for NETFLIX',
            'Hi, can you send me the photos from yesterday?',
        ]) assert.strictEqual(TxnParser.parse(sms), null, `should reject: ${sms}`);
    },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
    try { fn(); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}
console.log(`${Object.keys(tests).length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
