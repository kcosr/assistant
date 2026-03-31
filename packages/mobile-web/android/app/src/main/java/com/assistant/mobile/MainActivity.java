package com.assistant.mobile;


import android.os.Bundle;
import android.webkit.WebView;

import com.assistant.mobile.voice.AssistantVoicePlugin;
import com.getcapacitor.BridgeActivity;


public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AssistantVoicePlugin.class);
        super.onCreate(savedInstanceState);
        try {
            WebView wv = getBridge().getWebView();
            if (wv != null && wv.getSettings() != null) {
                wv.getSettings().setTextZoom(125);
            }
        } catch (Throwable t) { /* ignore */ }
    }

}
