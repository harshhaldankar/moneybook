package in.moneybook.app.capture;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Bridge for the web app: list and remove shared transactions waiting for review. */
@CapacitorPlugin(name = "MoneyCapture")
public class MoneyCapturePlugin extends Plugin {
    private static MoneyCapturePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Called after a share; tells an open app to refresh its list. */
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

    /** Returns (and clears) the id of the item that was just shared, if any. */
    @PluginMethod
    public void takeShared(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("id", CaptureStore.takeLastShared(getContext()));
        call.resolve(ret);
    }
}
