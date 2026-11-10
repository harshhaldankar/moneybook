package in.moneybook.app.capture;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads the text in a screenshot (bank SMS, GPay/PhonePe receipt) with ML Kit's
 * on-device text recognition. The image never leaves the phone.
 */
public final class ScreenshotReader {
    public interface Callback {
        /** Full text, plus each text block (roughly one message / paragraph) in screen order. */
        void onText(String text, List<String> blocks);
        void onError(String message);
    }

    private ScreenshotReader() {}

    public static void fromUri(Context ctx, Uri uri, Callback cb) {
        try {
            run(InputImage.fromFilePath(ctx, uri), cb);
        } catch (IOException e) {
            cb.onError("Couldn't open that image");
        }
    }

    public static void fromBase64(String data, Callback cb) {
        try {
            String b64 = data.contains(",") ? data.substring(data.indexOf(',') + 1) : data;
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) { cb.onError("That file isn't an image"); return; }
            run(InputImage.fromBitmap(bmp, 0), cb);
        } catch (IllegalArgumentException e) {
            cb.onError("That file isn't an image");
        }
    }

    private static void run(InputImage image, Callback cb) {
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer.process(image)
            .addOnSuccessListener(result -> {
                recognizer.close();
                List<String> blocks = new ArrayList<>();
                for (com.google.mlkit.vision.text.Text.TextBlock b : result.getTextBlocks()) blocks.add(b.getText());
                cb.onText(result.getText(), blocks);
            })
            .addOnFailureListener(e -> { recognizer.close(); cb.onError("Couldn't read text from the image. Try again in a minute."); });
    }
}
