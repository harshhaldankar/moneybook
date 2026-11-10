/* ========================================
   SMS PARSER - JavaScript twin of android/…/capture/TxnParser.java
   Used for "Paste SMS" (copy a bank SMS, paste it into MoneyBook).
   Keep both in sync; the same test cases run against each.

   Security rules (applied before anything is used):
    - Text that looks like an OTP / PIN / verification code is rejected outright.
    - Reminders, offers, failed or pending payments are rejected.
    - Only amount, debit/credit, last 4 digits, merchant and mode are extracted.
   ======================================== */

const TxnParser = (() => {
    const SENSITIVE = new RegExp(
        '\\b(otp|one[\\s-]?time[\\s-]?(pass(word|code)?|pin)|verification code|security code|secret code|passcode|'
        + 'cvv|m-?pin|upi pin|atm pin|login code|auth(entication)? code|activation code)\\b'
        + "|do not share|don'?t share|never share|not share (it|this)|share (this|the|your) (code|otp|pin)", 'i');

    const NOT_A_TXN = new RegExp(
        '\\b(will be debited|to be debited|is due|due on|due date|due by|min(imum)?\\.? (amt|amount) due|total (amt|amount) due|'
        + 'bill (amt|amount|generated|of)|e-?statement|requested|request(ed)? money|collect request|is pending|pending for|'
        + 'declined|failed|unsuccessful|could not be|not processed|has been blocked|insufficient|'
        + 'offer|up ?to rs|pre-?approved|eligible|apply now|loan of|congratulations|reward points|win\\b|lucky)', 'i');

    const AMOUNT = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
    const AMOUNT_BARE = /\b(?:debited|credited)\s+(?:by|with|for)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i;
    const RECEIVED_FROM_PERSON = /\b(paid you|sent you|you received|you've received|received from)\b/i;
    const UPI_PATH = /\bUPI\/(?:P2[AM]|DR|CR)?\/?[0-9]{6,}\/([A-Za-z][A-Za-z0-9 .&'-]{1,30})/i;
    const DEBIT = new RegExp(
        '\\b(debited|debit(ed)? (by|for|with|of)|spent|paid|sent|withdrawn|withdrawal|purchase|deducted|txn of|'
        + 'transaction of|transferred to|payment of|dr\\b)', 'i');
    const CREDIT = /\b(credited|credit(ed)? (by|with|of)|received|deposited|refund(ed)?|reversed|reversal|cr\b)/i;
    const LAST4 = /(?:a\/?c|acct|account|card|ac)\s*(?:no\.?|number|num)?\s*(?:ending(?:\s+(?:with|in))?)?\s*[:-]?\s*[x*•.]*\s*([0-9]{3,6})\b/i;
    // Payment-app receipts ("To Swiggy · ₹250 · Completed · UPI transaction ID …")
    const RECEIPT = /\b(completed|successful|success)\b/i;
    const RECEIPT_ID = /\b(upi (transaction|ref)( id| no)?|utr|transaction id|txn id|ref(erence)? (no|id))\b/i;
    // A receipt's first line says the direction: "To Swiggy" (paid) vs "Received from …"
    const RECEIPT_IN = /^\s*(from\b|received\b|money received)/i;
    const LAST4_MASKED = /[x*•]{2,}\s*([0-9]{4})\b(?!@)/i;
    // "Central Bank of India 1386" on payment-app receipts
    const LAST4_BANK = /\bbank(?: of [a-z]+)*\s+([0-9]{4})\b/i;
    const REF = /(?:ref(?:erence)?\.?\s*(?:no\.?|number|id)?|utr(?:\s*no\.?)?|upi (?:transaction|ref)\.?\s*(?:id|no\.?)?|transaction id|txn id|refno)\s*[:.-]?\s*([0-9]{9,18})\b/i;
    const VPA = /\b([a-z0-9][a-z0-9._-]{1,40})@[a-z]{2,20}\b/i;
    const MERCHANT_END = "([A-Za-z][A-Za-z0-9 .&'_*-]{1,40}?)"
        + '(?=\\s+(?:on|ref(?:no)?|via|using|upi|avl|avbl|bal|txn|thru|for|is|has|date|at|not|from)\\b|[.,;(@\\n]|\\s*$|\\s+\\d)';
    const MERCHANT_DEBIT = new RegExp('(?:\\bat\\b|\\bto\\b|\\btowards\\b|\\binfo[:\\s-]+|\\bon\\b)\\s*' + MERCHANT_END, 'gi');
    const MERCHANT_CREDIT = new RegExp('(?:\\bfrom\\b|\\bby\\b|\\binfo[:\\s-]+)\\s*' + MERCHANT_END, 'gi');
    const BAD_MERCHANT = /^(your|you|a\/?c|ac|acct|account|card|the|rs|inr|bank|upi|vpa|mobile|beneficiary|ref|self|date|neft|imps|rtgs|transfer|xx.*)\b|\bbank\b/i;
    const PAYER_FIRST = /^\s*([A-Za-z][A-Za-z .]{1,30}?)\s+(?:paid|sent) you\b/i;

    function clean(s) {
        let c = s.replace(/\s+/g, ' ').replace(/[*_]+/g, ' ').trim();
        c = c.replace(/\s+(on|ref|via|upi)$/i, '').trim();
        if (c.length > 30) c = c.slice(0, 30).trim();
        return c;
    }

    function merchant(text, type) {
        const u = UPI_PATH.exec(text);
        if (u) return clean(u[1]);
        const p = PAYER_FIRST.exec(text);
        if (p) return clean(p[1]);
        const re = type === 'credit' ? MERCHANT_CREDIT : MERCHANT_DEBIT;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
            const c = clean(m[1]);
            if (c && !BAD_MERCHANT.test(c)) return c;
            re.lastIndex = m.index + 1;   // retry inside a rejected candidate ("by NEFT from ACME…")
        }
        const v = VPA.exec(text);
        if (v) return clean(v[1].replace(/[._-]+/g, ' '));
        return '';
    }

    function isSensitive(text) {
        return !!text && SENSITIVE.test(text);
    }

    /** Returns { amount, type: 'debit'|'credit', last4, merchant, mode, ref } or null. ref = UPI ref / UTR. */
    function parse(text) {
        if (!text || text.length < 10 || text.length > 1000) return null;
        if (isSensitive(text) || NOT_A_TXN.test(text)) return null;

        const am = AMOUNT.exec(text) || AMOUNT_BARE.exec(text);
        if (!am) return null;
        const amount = parseFloat(am[1].replace(/,/g, ''));
        if (!(amount > 0) || amount > 1e8) return null;

        const dm = DEBIT.exec(text);
        const cm = CREDIT.exec(text);
        const receipt = RECEIPT.test(text) && RECEIPT_ID.test(text);
        if (!dm && !cm && !receipt) return null;

        // "debited from A/c … and credited to VPA …": whichever verb comes first describes your account
        const type = RECEIVED_FROM_PERSON.test(text) ? 'credit'
            : (dm || cm) ? (dm && (!cm || dm.index < cm.index) ? 'debit' : 'credit')
            : (RECEIPT_IN.test(text) ? 'credit' : 'debit');

        const lm = LAST4.exec(text);
        const bm = lm ? null : LAST4_BANK.exec(text);           // "Central Bank of India 1386" on receipts
        const mm = lm || bm ? null : LAST4_MASKED.exec(text);   // "XXXX4521"
        const last4 = lm ? (lm[1].length > 4 ? lm[1].slice(-4) : lm[1]) : (bm ? bm[1] : mm ? mm[1] : '');
        const rf = REF.exec(text);

        const lower = text.toLowerCase();
        let mode = 'UPI';
        if (lower.includes('upi') || lower.includes('vpa') || VPA.test(text)) mode = 'UPI';
        else if (lower.includes('atm') || lower.includes('withdrawn') || lower.includes('cash withdrawal')) mode = 'Cash';
        else if (lower.includes('card')) mode = 'Card';
        else if (/\b(neft|imps|rtgs|net ?banking)\b/.test(lower)) mode = 'Net Banking';

        return { amount, type, last4, merchant: merchant(text, type), mode, ref: rf ? rf[1] : '' };
    }

    return { parse, isSensitive };
})();

if (typeof module !== 'undefined') module.exports = TxnParser;
