package com.assistant.mobile.voice;

import java.util.UUID;

final class AssistantVoiceTurnOrigin {
    private static final String PROCESS_ID = UUID.randomUUID().toString();

    private AssistantVoiceTurnOrigin() {}

    static String get() {
        return PROCESS_ID;
    }
}
