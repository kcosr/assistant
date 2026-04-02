package com.assistant.mobile.voice;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
public final class AssistantVoiceConfigTest {
    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void saveAndLoadPersistSessionTitles() {
        Context context = RuntimeEnvironment.getApplication();
        AssistantVoiceConfig.save(context, createConfig(sessionTitles(
            "session-1",
            "Daily Assistant",
            "session-2",
            "Kitchen Notes"
        )));

        AssistantVoiceConfig loaded = AssistantVoiceConfig.load(context);

        assertEquals("Daily Assistant", loaded.getSessionTitle("session-1"));
        assertEquals("Kitchen Notes", loaded.getSessionTitle("session-2"));
        assertTrue(loaded.getSessionTitle("missing-session").isEmpty());
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void fromIntentReplacesSessionTitlesWithLatestBridgePayload() throws Exception {
        AssistantVoiceConfig fallback = createConfig(sessionTitles(
            "session-1",
            "Old Title",
            "session-2",
            "Stale Session"
        ));
        Intent intent = fallback
            .withSessionTitles(new JSONObject()
                .put("session-1", "Renamed Session")
                .put("session-3", "Fresh Session"))
            .applyToIntent(new Intent());

        AssistantVoiceConfig updated = AssistantVoiceConfig.fromIntent(intent, fallback);

        assertEquals("Renamed Session", updated.getSessionTitle("session-1"));
        assertEquals("Fresh Session", updated.getSessionTitle("session-3"));
        assertTrue(updated.getSessionTitle("session-2").isEmpty());
    }

    private static AssistantVoiceConfig createConfig(Map<String, String> titles) {
        return new AssistantVoiceConfig(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            true,
            "",
            AssistantVoiceConfig.DEFAULT_RECOGNITION_START_TIMEOUT_MS,
            AssistantVoiceConfig.DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS,
            AssistantVoiceConfig.DEFAULT_RECOGNITION_END_SILENCE_MS,
            "panel-1",
            "session-1",
            "session-1",
            titles,
            Arrays.asList("session-1", "session-2"),
            false,
            "",
            AssistantVoiceConfig.DEFAULT_VOICE_ADAPTER_BASE_URL,
            AssistantVoiceConfig.DEFAULT_ASSISTANT_BASE_URL
        );
    }

    private static Map<String, String> sessionTitles(String... entries) {
        LinkedHashMap<String, String> titles = new LinkedHashMap<>();
        for (int index = 0; index + 1 < entries.length; index += 2) {
            titles.put(entries[index], entries[index + 1]);
        }
        return titles;
    }
}
