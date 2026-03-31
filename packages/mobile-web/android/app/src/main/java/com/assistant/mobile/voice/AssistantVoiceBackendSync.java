package com.assistant.mobile.voice;

import android.content.Context;

public final class AssistantVoiceBackendSync {
    private AssistantVoiceBackendSync() {}

    public static void updateAssistantBaseUrl(Context context, String assistantBaseUrl) {
        AssistantVoiceConfig current = AssistantVoiceConfig.load(context);
        AssistantVoiceConfig updated = current.withAssistantBaseUrl(assistantBaseUrl);
        AssistantVoiceConfig.save(context, updated);
    }
}
