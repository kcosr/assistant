package com.assistant.mobile.voice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
public final class AssistantVoiceConfigTest {
    @Test
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

    @Test
    public void constructorClampsTtsGain() {
        assertEquals(0.25f, createConfig(0.05f).ttsGain, 0.0001f);
        assertEquals(5.0f, createConfig(9.0f).ttsGain, 0.0001f);
    }

    @Test
    public void constructorClampsRecognitionCueGain() {
        assertEquals(0.25f, createConfig(1.0f, true, 0.05f).recognitionCueGain, 0.0001f);
        assertEquals(5.0f, createConfig(1.0f, true, 9.0f).recognitionCueGain, 0.0001f);
    }

    @Test
    public void constructorClampsStartupPreRollMs() {
        assertEquals(0, createConfig(1.0f, true, 1.0f, -10).startupPreRollMs);
        assertEquals(4096, createConfig(1.0f, true, 1.0f, 99999).startupPreRollMs);
    }

    @Test
    public void withVoiceSettingsReadsTtsGain() throws Exception {
        AssistantVoiceConfig updated = createConfig(1.0f).withVoiceSettings(
            new JSONObject().put("ttsGain", 1.8)
        );

        assertEquals(1.8f, updated.ttsGain, 0.0001f);
    }

    @Test
    public void withVoiceSettingsReadsRecognitionCueSettings() throws Exception {
        AssistantVoiceConfig updated = createConfig(1.0f).withVoiceSettings(
            new JSONObject()
                .put("recognitionCueEnabled", false)
                .put("recognitionCueGain", 1.8)
        );

        assertFalse(updated.recognitionCueEnabled);
        assertEquals(1.8f, updated.recognitionCueGain, 0.0001f);
    }

    @Test
    public void withVoiceSettingsReadsRecognizeStopCommandSetting() throws Exception {
        AssistantVoiceConfig updated = createConfig(1.0f).withVoiceSettings(
            new JSONObject().put("recognizeStopCommandEnabled", false)
        );

        assertFalse(updated.recognizeStopCommandEnabled);
    }

    @Test
    public void withVoiceSettingsReadsStartupPreRollMs() throws Exception {
        AssistantVoiceConfig updated = createConfig(1.0f).withVoiceSettings(
            new JSONObject().put("startupPreRollMs", 768)
        );

        assertEquals(768, updated.startupPreRollMs);
    }

    @Test
    public void withVoiceSettingsReadsStandaloneNotificationPlaybackSetting() throws Exception {
        AssistantVoiceConfig updated = createConfig(1.0f).withVoiceSettings(
            new JSONObject().put("standaloneNotificationPlaybackEnabled", false)
        );

        assertFalse(updated.standaloneNotificationPlaybackEnabled);
    }

    @Test
    public void saveAndLoadPersistMediaButtonsEnabled() {
        Context context = RuntimeEnvironment.getApplication();
        AssistantVoiceConfig.save(context, createConfig(true));

        AssistantVoiceConfig loaded = AssistantVoiceConfig.load(context);

        assertTrue(loaded.mediaButtonsEnabled);
    }

    private static AssistantVoiceConfig createConfig(Map<String, String> titles) {
        return createConfig(titles, 1.0f);
    }

    private static AssistantVoiceConfig createConfig(float ttsGain) {
        return createConfig(
            Collections.emptyMap(),
            ttsGain,
            true,
            1.0f,
            AssistantVoiceConfig.DEFAULT_STARTUP_PRE_ROLL_MS,
            false
        );
    }

    private static AssistantVoiceConfig createConfig(
        float ttsGain,
        boolean recognitionCueEnabled,
        float recognitionCueGain
    ) {
        return createConfig(
            Collections.emptyMap(),
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            AssistantVoiceConfig.DEFAULT_STARTUP_PRE_ROLL_MS,
            false
        );
    }

    private static AssistantVoiceConfig createConfig(
        float ttsGain,
        boolean recognitionCueEnabled,
        float recognitionCueGain,
        int startupPreRollMs
    ) {
        return createConfig(
            Collections.emptyMap(),
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            startupPreRollMs,
            false
        );
    }

    private static AssistantVoiceConfig createConfig(boolean mediaButtonsEnabled) {
        return createConfig(
            Collections.emptyMap(),
            1.0f,
            true,
            1.0f,
            AssistantVoiceConfig.DEFAULT_STARTUP_PRE_ROLL_MS,
            mediaButtonsEnabled
        );
    }

    private static AssistantVoiceConfig createConfig(Map<String, String> titles, float ttsGain) {
        return createConfig(
            titles,
            ttsGain,
            true,
            1.0f,
            AssistantVoiceConfig.DEFAULT_STARTUP_PRE_ROLL_MS,
            false
        );
    }

    private static AssistantVoiceConfig createConfig(
        Map<String, String> titles,
        float ttsGain,
        boolean recognitionCueEnabled,
        float recognitionCueGain,
        int startupPreRollMs,
        boolean mediaButtonsEnabled
    ) {
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
            AssistantVoiceConfig.DEFAULT_ASSISTANT_BASE_URL,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            AssistantVoiceConfig.DEFAULT_RECOGNIZE_STOP_COMMAND_ENABLED,
            startupPreRollMs,
            mediaButtonsEnabled,
            false,
            true
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
