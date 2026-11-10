package in.moneybook.app.capture;

import android.content.Context;

import org.json.JSONObject;

/** Handles text the user shares to MoneyBook (e.g. a bank SMS): parse → store for review. */
public final class CaptureHandler {
    public enum Result { ADDED, ALREADY_ADDED, NOT_A_TRANSACTION, SENSITIVE }

    private CaptureHandler() {}

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
