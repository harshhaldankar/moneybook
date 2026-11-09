package in.moneybook.app.capture;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Receives incoming SMS (RECEIVE_SMS only, so the inbox is never read).
 * Messages from phone numbers are skipped before their text is even assembled.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null) return;

        // Long SMS arrive in parts; join them per sender
        Map<String, StringBuilder> bySender = new LinkedHashMap<>();
        for (SmsMessage p : parts) {
            String sender = p.getDisplayOriginatingAddress();
            if (!TxnParser.isBankSender(sender)) continue;
            StringBuilder sb = bySender.get(sender);
            if (sb == null) bySender.put(sender, sb = new StringBuilder());
            sb.append(p.getDisplayMessageBody());
        }
        for (StringBuilder body : bySender.values()) {
            CaptureHandler.handle(context, body.toString(), "sms");
        }
    }
}
