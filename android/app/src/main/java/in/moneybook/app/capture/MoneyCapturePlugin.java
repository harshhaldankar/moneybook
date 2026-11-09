package in.moneybook.app.capture;

import android.Manifest;
import android.content.Intent;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Bridge for the web app: list/remove detected transactions, check and request permissions. */
@CapacitorPlugin(
    name = "MoneyCapture",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS }) }
)
public class MoneyCapturePlugin extends Plugin {
    private static MoneyCapturePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Called from the receivers; tells an open app to refresh its list. */
    static void onCaptured(JSONObject item) {
        MoneyCapturePlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("captured", new JSObject(item.toString()));
        } catch (JSONException ignored) {
            // malformed item; the app picks it up on next resume anyway
        }
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSONArray items = CaptureStore.list(getContext());
        JSObject ret = new JSObject();
        try {
            ret.put("items", new JSArray(items.toString()));
        } catch (JSONException e) {
            ret.put("items", new JSArray());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        Set<String> set = new HashSet<>();
        for (int i = 0; i < ids.length(); i++) set.add(ids.optString(i));
        CaptureStore.remove(getContext(), set);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            call.resolve(statusObject());
        } else {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
        }
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openNotificationAccess(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private JSObject statusObject() {
        JSObject ret = new JSObject();
        ret.put("sms", getPermissionState("sms") == PermissionState.GRANTED);
        ret.put("upi", NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));
        return ret;
    }
}
