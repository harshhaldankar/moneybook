package in.moneybook.app.capture;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Reads payment notifications from an allow-list of UPI and bank apps only.
 * Notifications from every other app (chats, email, OTP apps…) are ignored without being read.
 */
public class PaymentNotificationListener extends NotificationListenerService {
    static final Set<String> PAYMENT_APPS = new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user", // Google Pay
        "com.phonepe.app",                        // PhonePe
        "net.one97.paytm",                        // Paytm
        "in.org.npci.upiapp",                     // BHIM
        "com.dreamplug.androidapp",               // CRED
        "com.mobikwik_new",                       // MobiKwik
        "in.amazon.mShop.android.shopping",       // Amazon Pay
        "com.snapwork.hdfc",                      // HDFC Bank
        "com.sbi.lotusintouch",                   // SBI YONO
        "com.csam.icici.bank.imobile",            // ICICI iMobile
        "com.axis.mobile",                        // Axis Mobile
        "com.msf.kbank.mobile",                   // Kotak
        "com.bankofbaroda.mconnect",              // Bank of Baroda
        "com.idfcfirstbank.optimus"               // IDFC FIRST
    ));

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !PAYMENT_APPS.contains(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0 || sbn.isOngoing()) return;
        Bundle extras = n.extras;
        if (extras == null) return;
        String title = str(extras.getCharSequence(Notification.EXTRA_TITLE));
        CharSequence big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        String text = big != null ? big.toString() : str(extras.getCharSequence(Notification.EXTRA_TEXT));
        CaptureHandler.handle(this, (title + " " + text).trim(), "upi");
    }

    private static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString();
    }
}
