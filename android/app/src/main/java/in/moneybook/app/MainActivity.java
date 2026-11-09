package in.moneybook.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import in.moneybook.app.capture.MoneyCapturePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MoneyCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
