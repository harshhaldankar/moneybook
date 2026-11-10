package in.moneybook.app.capture;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a bank SMS the user shared to MoneyBook into a transaction, or returns null.
 *
 * Security rules (applied before anything is stored):
 *  - Any text that looks like an OTP / PIN / verification code is rejected outright.
 *  - Reminders, offers, failed or pending payments are rejected.
 *  - Only amount, debit/credit, last 4 digits, merchant and mode are extracted; the message text is never kept.
 */
public final class TxnParser {

    public static final class Txn {
        public double amount;
        public String type;      // "debit" | "credit"
        public String last4 = "";
        public String merchant = "";
        public String mode = "UPI";
    }

    private static final Pattern SENSITIVE = Pattern.compile(
        "(?i)\\b(otp|one[\\s-]?time[\\s-]?(pass(word|code)?|pin)|verification code|security code|secret code|passcode|"
        + "cvv|m-?pin|upi pin|atm pin|login code|auth(entication)? code|activation code)\\b"
        + "|do not share|don'?t share|never share|not share (it|this)|share (this|the|your) (code|otp|pin)");

    private static final Pattern NOT_A_TXN = Pattern.compile(
        "(?i)\\b(will be debited|to be debited|is due|due on|due date|due by|min(imum)?\\.? (amt|amount) due|total (amt|amount) due|"
        + "bill (amt|amount|generated|of)|e-?statement|requested|request(ed)? money|collect request|is pending|pending for|"
        + "declined|failed|unsuccessful|could not be|not processed|has been blocked|insufficient|"
        + "offer|up ?to rs|pre-?approved|eligible|apply now|loan of|congratulations|reward points|win\\b|lucky)");

    private static final Pattern AMOUNT = Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)");
    private static final Pattern AMOUNT_BARE = Pattern.compile("(?i)\\b(?:debited|credited)\\s+(?:by|with|for)\\s+([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\b");
    private static final Pattern RECEIVED_FROM_PERSON = Pattern.compile("(?i)\\b(paid you|sent you|you received|you've received|received from)\\b");
    private static final Pattern UPI_PATH = Pattern.compile("(?i)\\bUPI/(?:P2[AM]|DR|CR)?/?[0-9]{6,}/([A-Za-z][A-Za-z0-9 .&'-]{1,30})");
    private static final Pattern DEBIT = Pattern.compile(
        "(?i)\\b(debited|debit(ed)? (by|for|with|of)|spent|paid|sent|withdrawn|withdrawal|purchase|deducted|txn of|"
        + "transaction of|transferred to|payment of|dr\\b)");
    private static final Pattern CREDIT = Pattern.compile(
        "(?i)\\b(credited|credit(ed)? (by|with|of)|received|deposited|refund(ed)?|reversed|reversal|cr\\b)");
    private static final Pattern LAST4 = Pattern.compile(
        "(?i)(?:a/?c|acct|account|card|ac)\\s*(?:no\\.?|number|num)?\\s*(?:ending(?:\\s+(?:with|in))?)?\\s*[:\\-]?\\s*[x*•.]*\\s*([0-9]{3,6})\\b");
    private static final Pattern VPA = Pattern.compile("(?i)\\b([a-z0-9][a-z0-9._-]{1,40})@[a-z]{2,20}\\b");
    private static final String MERCHANT_END =
        "([A-Za-z][A-Za-z0-9 .&'_*-]{1,40}?)"
        + "(?=\\s+(?:on|ref(?:no)?|via|using|upi|avl|avbl|bal|txn|thru|for|is|has|date|at|not|from)\\b|[.,;(@\\n]|\\s*$|\\s+\\d)";
    private static final Pattern MERCHANT_DEBIT = Pattern.compile(
        "(?i)(?:\\bat\\b|\\bto\\b|\\btowards\\b|\\binfo[:\\s-]+|\\bon\\b)\\s*" + MERCHANT_END);
    private static final Pattern MERCHANT_CREDIT = Pattern.compile(
        "(?i)(?:\\bfrom\\b|\\bby\\b|\\binfo[:\\s-]+)\\s*" + MERCHANT_END);
    private static final Pattern BAD_MERCHANT = Pattern.compile(
        "(?i)^(your|you|a/?c|ac|acct|account|card|the|rs|inr|bank|upi|vpa|mobile|beneficiary|ref|self|date|neft|imps|rtgs|transfer|xx.*)\\b|\\bbank\\b");

    private TxnParser() {}

    /** Indian bank SMS come from DLT headers like "AX-HDFCBK", "VM-SBIUPI", "JD-ICICIT-S". */
    public static boolean isBankSender(String sender) {
        if (sender == null) return false;
        String s = sender.trim().toUpperCase(Locale.ROOT);
        if (s.matches("^\\+?[0-9 ]+$")) return false;   // personal phone numbers: never read
        return s.matches("^([A-Z0-9]{2}-)?[A-Z0-9]{4,9}(-[A-Z])?$") && s.matches(".*[A-Z].*");
    }

    public static boolean isSensitive(String text) {
        return text != null && SENSITIVE.matcher(text).find();
    }

    public static Txn parse(String text) {
        if (text == null || text.length() < 10 || text.length() > 1000) return null;
        if (isSensitive(text) || NOT_A_TXN.matcher(text).find()) return null;

        Matcher am = AMOUNT.matcher(text);
        if (!am.find()) {
            am = AMOUNT_BARE.matcher(text);
            if (!am.find()) return null;
        }
        double amount;
        try { amount = Double.parseDouble(am.group(1).replace(",", "")); } catch (NumberFormatException e) { return null; }
        if (amount <= 0 || amount > 1e8) return null;

        Matcher dm = DEBIT.matcher(text);
        Matcher cm = CREDIT.matcher(text);
        boolean debit = dm.find(), credit = cm.find();
        if (!debit && !credit) return null;

        Txn t = new Txn();
        t.amount = amount;
        // "debited from A/c … and credited to VPA …": whichever verb comes first describes your account
        t.type = RECEIVED_FROM_PERSON.matcher(text).find() ? "credit"
            : debit && (!credit || dm.start() < cm.start()) ? "debit" : "credit";

        Matcher lm = LAST4.matcher(text);
        if (lm.find()) {
            String d = lm.group(1);
            t.last4 = d.length() > 4 ? d.substring(d.length() - 4) : d;
        }

        t.merchant = merchant(text, t.type);
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.contains("upi") || lower.contains("vpa") || VPA.matcher(text).find()) t.mode = "UPI";
        else if (lower.contains("atm") || lower.contains("withdrawn") || lower.contains("cash withdrawal")) t.mode = "Cash";
        else if (lower.contains("card")) t.mode = "Card";
        else if (lower.matches("(?s).*\\b(neft|imps|rtgs|net ?banking)\\b.*")) t.mode = "Net Banking";
        return t;
    }

    private static String merchant(String text, String type) {
        Matcher u = UPI_PATH.matcher(text);
        if (u.find()) return clean(u.group(1));
        // "Rahul paid you ₹100": the payer comes first
        Matcher p = Pattern.compile("(?i)^\\s*([A-Za-z][A-Za-z .]{1,30}?)\\s+(?:paid|sent) you\\b").matcher(text);
        if (p.find()) return clean(p.group(1));
        Matcher m = ("credit".equals(type) ? MERCHANT_CREDIT : MERCHANT_DEBIT).matcher(text);
        int from = 0;
        while (m.find(from)) {
            String c = clean(m.group(1));
            if (!c.isEmpty() && !BAD_MERCHANT.matcher(c).find()) return c;
            from = m.start() + 1;   // retry inside a rejected candidate ("by NEFT from ACME…")
        }
        Matcher v = VPA.matcher(text);
        if (v.find()) return clean(v.group(1).replaceAll("[._-]+", " "));
        return "";
    }

    private static String clean(String s) {
        String c = s.replaceAll("\\s+", " ").replaceAll("[*_]+", " ").trim();
        c = c.replaceAll("(?i)\\s+(on|ref|via|upi)$", "").trim();
        if (c.length() > 30) c = c.substring(0, 30).trim();
        return c;
    }
}
