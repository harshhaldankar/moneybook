package in.moneybook.app;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import in.moneybook.app.capture.CaptureHandler;
import in.moneybook.app.capture.MoneyCapturePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MoneyCapturePlugin.class);
        super.onCreate(savedInstanceState);
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
    }

    /** "Share → MoneyBook": only the text the user chose to share is read. */
    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        setIntent(new Intent(this, MainActivity.class));   // don't handle the same share twice
        if (text == null) return;

        CaptureHandler.Result r = CaptureHandler.handleShared(this, text);
        String msg = null;
        if (r == CaptureHandler.Result.SENSITIVE) msg = "That looks like an OTP or code, so it was not saved";
        else if (r == CaptureHandler.Result.NOT_A_TRANSACTION) msg = "No debit or credit found in that message";
        else if (r == CaptureHandler.Result.ALREADY_ADDED) msg = "This transaction was already added";
        if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }
}
