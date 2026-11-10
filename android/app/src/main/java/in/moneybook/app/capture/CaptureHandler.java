package in.moneybook.app.capture;

import android.content.Context;

import org.json.JSONObject;

import java.util.List;

/** Handles text the user shares to MoneyBook (e.g. a bank SMS): parse → store for review. */
public final class CaptureHandler {
    public enum Result { ADDED, ALREADY_ADDED, NOT_A_TRANSACTION, SENSITIVE }

    private CaptureHandler() {}

    /**
     * Shared screenshot: drop any text block that looks like an OTP or code, then hand the rest
     * to the app (in memory only), which lists every transaction it finds for review.
     */
    public static Result handleSharedScreenshot(String full, List<String> blocks) {
        List<String> safe = new java.util.ArrayList<>();
        boolean sawSensitive = false, sawTxn = false;
        for (String b : blocks) {
            if (TxnParser.isSensitive(b)) { sawSensitive = true; continue; }
            safe.add(b);
            if (TxnParser.parse(b) != null) sawTxn = true;
        }
        String safeFull = TxnParser.isSensitive(full) ? "" : full;
        if (!sawTxn && TxnParser.parse(safeFull) == null) return sawSensitive ? Result.SENSITIVE : Result.NOT_A_TRANSACTION;
        MoneyCapturePlugin.onScanned(safeFull, safe);
        return Result.ADDED;
    }

    public static Result handleShared(Context ctx, String text) {
        // OTPs and codes are refused before anything else happens with the text
        if (TxnParser.isSensitive(text)) return Result.SENSITIVE;
        TxnParser.Txn t = TxnParser.parse(text);
        if (t == null) return Result.NOT_A_TRANSACTION;
        JSONObject stored = CaptureStore.add(ctx, t, "share", System.currentTimeMillis());
        if (stored == null) return Result.ALREADY_ADDED;
        CaptureStore.setLastShared(ctx, stored.optString("id"));
        MoneyCapturePlugin.onCaptured(stored);
        return Result.ADDED;
    }
}
