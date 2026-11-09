package in.moneybook.app.capture;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.Locale;

import in.moneybook.app.MainActivity;
import in.moneybook.app.R;

/** Shared path for SMS and payment-app captures: parse → store → notify. */
public final class CaptureHandler {
    private static final String CHANNEL = "captures";

    private CaptureHandler() {}

    public static void handle(Context ctx, String text, String source) {
        TxnParser.Txn t = TxnParser.parse(text);
        if (t == null) return;
        JSONObject stored = CaptureStore.add(ctx, t, source, System.currentTimeMillis());
        if (stored == null) return;
        MoneyCapturePlugin.onCaptured(stored);
        notifyUser(ctx, t, stored.optString("id"));
    }

    private static void notifyUser(Context ctx, TxnParser.Txn t, String id) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Detected transactions", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Payments detected from bank SMS and payment apps");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }

        NumberFormat inr = NumberFormat.getNumberInstance(new Locale("en", "IN"));
        inr.setMaximumFractionDigits(2);
        String title = "₹" + inr.format(t.amount) + ("credit".equals(t.type) ? " received" : " spent")
            + (t.merchant.isEmpty() ? "" : ("credit".equals(t.type) ? " from " : " at ") + t.merchant);
        String body = (t.last4.isEmpty() ? "" : "A/c ••" + t.last4 + " · ") + "Tap to review and save in MoneyBook";

        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_moneybook)
            .setColor(0xFF1F5FAE)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        try {
            NotificationManagerCompat.from(ctx).notify(id.hashCode(), b.build());
        } catch (SecurityException ignored) {
            // notification permission revoked
        }
    }
}
