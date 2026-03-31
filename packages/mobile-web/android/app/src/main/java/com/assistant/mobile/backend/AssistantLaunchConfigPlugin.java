package com.assistant.mobile.backend;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AssistantLaunchConfig")
public final class AssistantLaunchConfigPlugin extends Plugin {
    @PluginMethod
    public void resolveLaunchBackend(PluginCall call) {
        AssistantBackendEntry cached = AssistantBackendLaunchSession.getSelectedBackend();
        if (cached != null) {
            call.resolve(buildPayload(cached));
            return;
        }
        Activity activity = getActivity();
        if (activity != null) {
            activity.finish();
        }
        call.reject("Launch backend unavailable");
    }

    private JSObject buildPayload(AssistantBackendEntry entry) {
        JSObject selectedBackend = new JSObject();
        selectedBackend.put("id", entry.id);
        selectedBackend.put("label", entry.label);
        selectedBackend.put("url", entry.url);

        JSObject payload = new JSObject();
        payload.put("selectedBackend", selectedBackend);
        return payload;
    }
}
