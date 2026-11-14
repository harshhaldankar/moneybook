package in.moneybook.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import in.moneybook.app.capture.CaptureHandler;
import in.moneybook.app.capture.MoneyCapturePlugin;
import in.moneybook.app.capture.ScreenshotReader;
import in.moneybook.app.update.UpdateCheckService;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MoneyCapturePlugin.class);
        super.onCreate(savedInstanceState);
        UpdateCheckService.schedule(this);
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
    }

    /** "Share → MoneyBook": only the text or screenshot the user chose to share is read. */
    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        Uri image = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        setIntent(new Intent(this, MainActivity.class));   // don't handle the same share twice

        if (type != null && type.startsWith("image/") && image != null) {
            Toast.makeText(this, "Reading the screenshot…", Toast.LENGTH_SHORT).show();
            ScreenshotReader.fromUri(this, image, new ScreenshotReader.Callback() {
                @Override public void onText(String ocr, java.util.List<String> blocks) {
                    runOnUiThread(() -> showResult(CaptureHandler.handleSharedScreenshot(ocr, blocks)));
                }
                @Override public void onError(String message) { runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show()); }
            });
            return;
        }
        if (text == null) return;
        showResult(CaptureHandler.handleShared(this, text));
    }

    private void showResult(CaptureHandler.Result r) {
        String msg = null;
        if (r == CaptureHandler.Result.SENSITIVE) msg = "That looks like an OTP or code, so it was not saved";
        else if (r == CaptureHandler.Result.NOT_A_TRANSACTION) msg = "No debit or credit found in that message or screenshot";
        else if (r == CaptureHandler.Result.ALREADY_ADDED) msg = "This transaction was already added";
        if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }
}
