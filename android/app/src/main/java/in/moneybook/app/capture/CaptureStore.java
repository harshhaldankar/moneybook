package in.moneybook.app.capture;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Set;
import java.util.UUID;

/**
 * Detected transactions waiting for review in the app.
 * Stores only parsed fields (never the SMS / notification text), in app-private storage.
 */
public final class CaptureStore {
    private static final String PREFS = "moneybook_captures";
    private static final String KEY = "items";
    private static final int MAX_ITEMS = 200;
    private static final long DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

    private CaptureStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized JSONArray list(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void save(Context ctx, JSONArray items) {
        prefs(ctx).edit().putString(KEY, items.toString()).apply();
    }

    /**
     * Adds a capture unless the same payment was already seen (bank SMS and the UPI app
     * usually both report it). Returns the stored item, or null for a duplicate.
     */
    public static synchronized JSONObject add(Context ctx, TxnParser.Txn t, String source, long ts) {
        JSONArray items = list(ctx);
        try {
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.getJSONObject(i);
                boolean same = Math.abs(o.getDouble("amount") - t.amount) < 0.01
                    && o.getString("type").equals(t.type)
                    && Math.abs(o.getLong("ts") - ts) < DUPLICATE_WINDOW_MS;
                if (same) {
                    // Fill in whatever the first report was missing
                    if (o.optString("last4").isEmpty() && !t.last4.isEmpty()) o.put("last4", t.last4);
                    if (o.optString("merchant").isEmpty() && !t.merchant.isEmpty()) o.put("merchant", t.merchant);
                    save(ctx, items);
                    return null;
                }
            }
            JSONObject o = new JSONObject();
            o.put("id", UUID.randomUUID().toString());
            o.put("amount", t.amount);
            o.put("type", t.type);
            o.put("last4", t.last4);
            o.put("merchant", t.merchant);
            o.put("mode", t.mode);
            o.put("source", source);
            o.put("ts", ts);
            items.put(o);
            while (items.length() > MAX_ITEMS) items.remove(0);
            save(ctx, items);
            return o;
        } catch (JSONException e) {
            return null;
        }
    }

    public static synchronized void remove(Context ctx, Set<String> ids) {
        JSONArray items = list(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o != null && !ids.contains(o.optString("id"))) kept.put(o);
        }
        save(ctx, kept);
    }
}
