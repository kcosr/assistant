package com.assistant.mobile.voice;

import static org.junit.Assert.assertEquals;
import android.os.Build;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
public final class AssistantVoiceUrlUtilsTest {
    @Test
    public void speechRoutesPreserveReverseProxyPrefix() {
        String base = "https://assistant/speech/v1/";
        assertEquals("wss://assistant/speech/v1/realtime?intent=transcription", AssistantVoiceUrlUtils.speechRealtimeUrl(base));
        assertEquals("https://assistant/speech/v1/audio/speech", AssistantVoiceUrlUtils.speechSynthesisUrl(base));
        assertEquals("https://assistant/speech/v1/audio/capabilities", AssistantVoiceUrlUtils.speechModelsUrl(base));
    }

    @Test(expected = IllegalArgumentException.class)
    public void speechRoutesRejectUrlEmbeddedCredentials() {
        AssistantVoiceUrlUtils.speechModelsUrl("https://assistant/speech/v1?token=secret");
    }

    @Test
    public void localSpeechRoutesUseInsecureWebSocketScheme() {
        assertEquals("ws://localhost:8000/v1/realtime?intent=transcription", AssistantVoiceUrlUtils.speechRealtimeUrl("http://localhost:8000/v1"));
    }
}
