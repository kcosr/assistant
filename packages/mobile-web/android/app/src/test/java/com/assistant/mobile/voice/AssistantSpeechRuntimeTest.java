package com.assistant.mobile.voice;

import static org.junit.Assert.*;

import android.os.Build;
import android.os.Looper;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/** Exercises the service's transport orchestration, independently of physical microphone hardware. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
@LooperMode(LooperMode.Mode.PAUSED)
public final class AssistantSpeechRuntimeTest {
    private ServiceController<AssistantVoiceRuntimeService> controller;
    private AssistantVoiceRuntimeService service;

    @Before public void createDisabledServiceBeforeInjectingEnabledConfig() throws Exception {
        AssistantVoiceConfig initial = AssistantVoiceConfig.load(RuntimeEnvironment.getApplication())
            .withVoiceSettings(new JSONObject().put("audioMode", "off")
                .put("speechServerBaseUrl", "http://127.0.0.1:1/runtime-speech")
                .put("assistantBaseUrl", "http://127.0.0.1:1/runtime-assistant")
                .put("recognitionCueEnabled", false));
        AssistantVoiceConfig.save(RuntimeEnvironment.getApplication(), initial);
        controller = Robolectric.buildService(AssistantVoiceRuntimeService.class).create();
        service = controller.get();
        set("config", initial.withVoiceSettings(new JSONObject().put("audioMode", "manual")));
        set("speechReady", true);
        set("assistantSocketConnected", true);
    }

    @After public void destroyService() {
        if (controller != null) controller.destroy();
    }

    @Test public void assistantReconnectPreservesSpeechSetupError() throws Exception {
        set("speechReady", false);
        set("speechSetupError", "Save a speech server token in Voice settings");
        invoke("updateState", new Class<?>[] {String.class, String.class},
            "connecting", null);
        assertEquals("error", get("runtimeState"));
        invoke("updateState", new Class<?>[] {String.class, String.class},
            "connecting", "Assistant socket closed");
        assertEquals("error", get("runtimeState"));
        assertEquals("error", invoke("resolveInactiveState", new Class<?>[0]));
        invoke("syncRuntimeSnapshot", new Class<?>[] {boolean.class}, false);
        assertEquals("Save a speech server token in Voice settings",
            AssistantVoiceConfig.loadRuntimeError(RuntimeEnvironment.getApplication()));
    }

    @Test public void quietCaptureStopsWithoutCommittingAndCancelsTransport() throws Exception {
        Recording operation = armRecognition("quiet-request", false);
        invoke("handleMicCaptureStopped", new Class<?>[] {String.class}, "quiet-request");
        assertEquals(0, operation.commits);
        assertEquals(1, operation.cancels);
        assertEquals("", get("activeSttRequestId"));
        assertNull(get("recognition"));
        assertEquals(AssistantVoiceRuntimeService.buildRecognitionCompletionCueRequestId("quiet-request"),
            get("pendingRecognitionCompletionCuePlaybackRequestId"));
    }

    @Test public void voicedCaptureCommitsOnceAfterMicStops() throws Exception {
        Recording operation = armRecognition("spoken-request", true);
        invoke("handleMicCaptureStopped", new Class<?>[] {String.class}, "spoken-request");
        invoke("handleMicCaptureStopped", new Class<?>[] {String.class}, "spoken-request");
        assertEquals(1, operation.commits);
        assertEquals(0, operation.cancels);
        assertEquals("spoken-request", get("activeSttRequestId"));
        assertTrue((Boolean) get("recognitionCommitted"));
    }

    @Test public void oldMicStopAndOldTranscriptCannotChangeNewRecognition() throws Exception {
        Recording current = armRecognition("current-request", true);
        invoke("handleMicCaptureStopped", new Class<?>[] {String.class}, "old-request");
        result("old-request", true, "a late transcript", "");
        assertEquals(0, current.commits);
        assertEquals(0, current.cancels);
        assertEquals("current-request", get("activeSttRequestId"));
        assertEquals("session-current", get("activeVoiceSessionId"));
        assertEquals("", get("stoppedRecognitionRequestId"));
        assertEquals("", get("pendingRecognitionCompletionCueRequestId"));
    }

    @Test public void transportTranscriptCallbackPostedBeforeStopIsIgnoredAfterCancel() throws Exception {
        AssistantSpeechClient closedClient = closedClient();
        set("speechClient", closedClient);
        invoke("startRecognition", new Class<?>[] {String.class, String.class}, "session-old", "manual_listen");
        Object operation = get("recognition");
        AssistantSpeechClient.RecognitionListener listener = (AssistantSpeechClient.RecognitionListener)
            field(operation, "listener");
        // Simulate a successful response racing local stop, already posted to the runtime handler.
        listener.completed("late recognized speech", 500);
        invoke("stopCurrentInteraction", new Class<?>[] {boolean.class, String.class}, false, "config_changed");
        Recording current = armRecognition("new-request", true);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("new-request", get("activeSttRequestId"));
        assertSame(current, get("recognition"));
        assertEquals(0, current.cancels);
        assertEquals("", get("pendingRecognitionSubmitSessionId"));
    }

    @Test public void lateSynthesisCallbacksCannotFinishReplacementPlayback() throws Exception {
        set("speechClient", closedClient());
        invoke("beginQueuedPlayback", new Class<?>[] {AssistantVoiceQueueItem.class}, speechItem("old-item"));
        Object operation = get("speechPlayback");
        AssistantSpeechClient.SpeechListener listener = (AssistantSpeechClient.SpeechListener)
            field(operation, "listener");
        invoke("stopCurrentInteraction", new Class<?>[] {boolean.class, String.class}, false, "config_changed");
        set("activeTtsRequestId", "replacement-request");
        set("activeQueueItem", speechItem("replacement-item"));
        listener.pcm(new byte[4800], 24000);
        listener.completed();
        listener.failed("late failure");
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("replacement-request", get("activeTtsRequestId"));
        assertEquals("replacement-item", ((AssistantVoiceQueueItem) get("activeQueueItem")).sourceEventId);
        assertEquals("", get("pendingPlaybackDrainRequestId"));
        assertEquals(0, get("activeTtsAudioBytes"));
    }

    @Test public void endpointChangeCancelsCaptureAndClosesPriorClient() throws Exception {
        AssistantSpeechClient prior = newClient();
        set("speechClient", prior);
        Recording operation = armRecognition("endpoint-request", true);
        AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
        invoke("applyConfig", new Class<?>[] {AssistantVoiceConfig.class},
            config.withVoiceSettings(new JSONObject().put("speechServerBaseUrl", "http://127.0.0.1:1/other-speech")));
        assertEquals(1, operation.cancels);
        assertEquals("", get("activeSttRequestId"));
        assertFalse((Boolean) get("speechReady"));
        assertNull(get("speechClient"));
        assertClientClosed(prior);
        result("endpoint-request", true, "late result from old endpoint", "");
        assertEquals("", get("pendingRecognitionSubmitSessionId"));
    }

    @Test public void removingTokenWithUnchangedSettingsCancelsActiveCapture() throws Exception {
        AssistantSpeechClient prior = newClient();
        set("speechClient", prior);
        // The persisted credential is absent; this is the in-memory credential used by the old client.
        set("speechCredential", "removed-device-local-token");
        Recording operation = armRecognition("credential-request", true);
        invoke("applyConfig", new Class<?>[] {AssistantVoiceConfig.class}, get("config"));
        assertEquals(1, operation.cancels);
        assertEquals("", get("activeSttRequestId"));
        assertEquals("", get("speechCredential"));
        assertNull(get("speechClient"));
        assertClientClosed(prior);
    }

    @Test public void settingsChangeRetainsQueuedPlaybackUntilNewSpeechServiceIsReady() throws Exception {
        AssistantSpeechClient prior = closedClient();
        set("speechClient", prior);
        set("activeTtsRequestId", "old-playback");
        set("activeQueueItem", speechItem("old-item"));
        queue().add(speechItem("next-item"));
        AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
        invoke("applyConfig", new Class<?>[] {AssistantVoiceConfig.class},
            config.withVoiceSettings(new JSONObject().put("speechVoice", "replacement-voice")));
        assertEquals("", get("activeTtsRequestId"));
        assertEquals("", get("activeSttRequestId"));
        assertNull(get("activeQueueItem"));
        assertEquals(1, queue().size());
        assertEquals("next-item", queue().get(0).sourceEventId);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, queue().size());
    }

    @Test public void completionCueFinishesBeforeNextQueuedItemCanDrain() throws Exception {
        set("speechClient", closedClient());
        armRecognition("quiet-request", false);
        invoke("handleMicCaptureStopped", new Class<?>[] {String.class}, "quiet-request");
        queue().add(speechItem("queued-after-capture"));
        invoke("drainVoiceQueueIfPossible", new Class<?>[0]);
        assertEquals(1, queue().size());
        assertEquals("", get("activeTtsRequestId"));
        invoke("handleMicCaptureStopped", new Class<?>[] {String.class}, "quiet-request");
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1));
        assertTrue(queue().isEmpty());
        assertEquals("", get("pendingRecognitionCompletionCueRequestId"));
        assertEquals("", get("pendingRecognitionCompletionCuePlaybackRequestId"));
    }

    @Test public void failureBeforeMicCaptureStillFinishesCueAndDrainsQueuedPlayback() throws Exception {
        set("speechClient", closedClient());
        invoke("startRecognition", new Class<?>[] {String.class, String.class}, "session-current", "manual_listen");
        queue().add(speechItem("queued-after-setup-failure"));
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1));
        assertEquals("", get("activeSttRequestId"));
        assertEquals("", get("pendingRecognitionCompletionCueRequestId"));
        assertEquals("", get("pendingRecognitionCompletionCuePlaybackRequestId"));
        assertTrue(queue().isEmpty());
    }

    @Test public void localSynthesisCancellationDrainsPendingManualPreemptionAfterCleanup() throws Exception {
        set("speechClient", closedClient());
        set("activeTtsRequestId", "old-playback");
        set("activeQueueItem", speechItem("old-item"));
        set("pendingManualPreemptQueueItem", speechItem("replacement-item"));
        int[] canceled = {0};
        set("speechPlayback", (AssistantSpeechClient.Operation) () -> canceled[0]++);
        invoke("stopCurrentInteraction", new Class<?>[] {boolean.class, String.class}, false,
            "manual_notification_preempt");
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, canceled[0]);
        assertEquals("", get("pendingManualPreemptStopRequestId"));
        assertNull(get("pendingManualPreemptQueueItem"));
        assertTrue(queue().isEmpty());
    }

    @Test public void microphoneStartFailureReleasesPreviouslyGrantedCaptureFocus() throws Exception {
        Recording operation = armRecognition("mic-start-failure", false);
        set("microphoneRequestId", "");
        AssistantVoicePcmPlayer player = (AssistantVoicePcmPlayer) get("player");
        assertTrue(player.beginRecognitionCaptureFocus());
        assertEquals("CAPTURE", field(player, "focusMode").toString());
        result("mic-start-failure", false, "", "Microphone capture is unavailable");
        assertEquals(1, operation.cancels);
        assertEquals("NONE", field(player, "focusMode").toString());
    }

    private Recording armRecognition(String request, boolean speech) throws Exception {
        Recording operation = new Recording();
        AssistantSpeechCapturePolicy policy = new AssistantSpeechCapturePolicy(300, 1000, 200, 48000);
        byte[] pcm = new byte[4800];
        if (speech) {
            for (int offset = 0; offset < pcm.length; offset += 2) { pcm[offset] = (byte) 0xe8; pcm[offset + 1] = 3; }
        }
        policy.accept(pcm);
        set("activeSttRequestId", request);
        set("microphoneRequestId", request);
        set("activeVoiceSessionId", "session-current");
        set("activePromptToolName", "voice_manual");
        set("recognition", operation);
        set("recognitionCommitted", false);
        set("capturePolicy", policy);
        return operation;
    }

    private AssistantSpeechClient newClient() {
        return new AssistantSpeechClient("http://127.0.0.1:1/runtime-speech", "test-device-token",
            "parakeet-local", "kokoro-local", "af_heart");
    }

    private AssistantSpeechClient closedClient() {
        AssistantSpeechClient client = newClient();
        client.close();
        return client;
    }

    private void assertClientClosed(AssistantSpeechClient client) {
        AtomicReference<String> failure = new AtomicReference<>();
        client.discover(new AssistantSpeechClient.DiscoveryListener() {
            @Override public void ready(JSONObject catalog) { fail("Closed clients must not perform discovery"); }
            @Override public void failed(String message) { failure.set(message); }
        });
        assertEquals("speech_client_closed", failure.get());
    }

    private void result(String request, boolean success, String text, String error) throws Exception {
        invoke("handleSttResult", new Class<?>[] {String.class, boolean.class, boolean.class, String.class,
            String.class, int.class}, request, success, false, text, error, 100);
    }

    private static AssistantVoiceQueueItem speechItem(String id) {
        return AssistantVoiceQueueItem.fromManualText(id, "session-current", "Session", "Speech", "Hello");
    }

    @SuppressWarnings("unchecked") private List<AssistantVoiceQueueItem> queue() throws Exception {
        return (List<AssistantVoiceQueueItem>) get("queuedVoiceItems");
    }

    private Object invoke(String name, Class<?>[] types, Object... arguments) throws Exception {
        Method method = AssistantVoiceRuntimeService.class.getDeclaredMethod(name, types);
        method.setAccessible(true);
        return method.invoke(service, arguments);
    }

    private Object get(String name) throws Exception { return field(service, name); }

    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    private void set(String name, Object value) throws Exception {
        Field field = AssistantVoiceRuntimeService.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(service, value);
    }

    private static final class Recording implements AssistantSpeechClient.Recognition {
        int commits;
        int cancels;
        @Override public boolean append(byte[] pcm) { return true; }
        @Override public void commit() { commits++; }
        @Override public long maxBufferBytes() { return 48000; }
        @Override public void cancel() { cancels++; }
    }
}
