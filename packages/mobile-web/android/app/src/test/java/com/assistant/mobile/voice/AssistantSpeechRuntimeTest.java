package com.assistant.mobile.voice;

import static org.junit.Assert.*;

import android.os.Build;
import android.os.Looper;
import android.app.Notification;
import com.assistant.mobile.R;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import javax.crypto.spec.SecretKeySpec;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.SocketPolicy;
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
@Config(sdk = Build.VERSION_CODES.N, shadows = AssistantSpeechCredentialStoreTest.MissingAwarePosix.class)
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
        set("config", ((AssistantVoiceConfig) get("config")).withVoiceSettings(
            new JSONObject().put("voiceRuntimeMode", "realtime")));
        AssistantSpeechClient prior = newClient();
        set("speechClient", prior);
        // The persisted credential is absent; this is the in-memory credential used by the old client.
        set("speechCredential", "removed-device-local-token");
        Recording operation = armRecognition("credential-request", true);
        service.onStartCommand(AssistantVoiceRuntimeService.applyConfigIntent(service,
            (AssistantVoiceConfig) get("config"), true), 0, 1);
        assertEquals(1, operation.cancels);
        assertEquals("", get("activeSttRequestId"));
        assertEquals("", get("speechCredential"));
        assertNull(get("speechClient"));
        assertClientClosed(prior);
    }

    @Test public void unrelatedSettingsDoNotReloadMissingPersistedCredentialOrCancelCapture() throws Exception {
        AssistantSpeechClient prior = newClient();
        set("speechClient", prior);
        set("speechCredential", "loaded-valid-token");
        set("speechCredentialLoaded", true);
        Recording operation = armRecognition("settings-request", true);
        AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
        invoke("applyConfig", new Class<?>[] {AssistantVoiceConfig.class}, config.withVoiceSettings(
            new JSONObject().put("selectedSessionId", "different-session").put("ttsGain", 0.8)
                .put("recognitionCompletionTimeoutMs", 1200)));
        assertSame(prior, get("speechClient"));
        assertEquals("loaded-valid-token", get("speechCredential"));
        assertEquals("settings-request", get("activeSttRequestId"));
        assertEquals(0, operation.cancels);
    }

    @Test public void failedExplicitCredentialReadPreservesLoadedCredentialAndCapture() throws Exception {
        AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
        // Production cannot decrypt this record without AndroidKeyStore in the JVM test.
        AssistantSpeechCredentialStore store = new AssistantSpeechCredentialStore(service.getNoBackupFilesDir(),
            service.getPackageName() + "\n" + config.assistantBaseUrl, () -> new SecretKeySpec(new byte[32], "AES"));
        store.set(config.speechServerBaseUrl, "persisted-token");
        try {
            AssistantSpeechClient prior = newClient();
            set("speechClient", prior);
            set("speechCredential", "loaded-valid-token");
            set("speechCredentialLoaded", true);
            Recording operation = armRecognition("credential-read-failure", true);
            service.onStartCommand(AssistantVoiceRuntimeService.applyConfigIntent(service, config, true), 0, 1);
            assertSame(prior, get("speechClient"));
            assertEquals("loaded-valid-token", get("speechCredential"));
            assertEquals("credential-read-failure", get("activeSttRequestId"));
            assertEquals(0, operation.cancels);
        } finally { store.remove(config.speechServerBaseUrl); }
    }

    @Test public void recognitionShowsListeningAndStopWhileSessionSetupIsPending() throws Exception {
        set("speechClient", closedClient());
        invoke("startRecognition", new Class<?>[] {String.class, String.class}, "session-current", "manual_listen");
        assertEquals(AssistantVoiceRuntimeService.STATE_LISTENING, get("runtimeState"));
        assertFalse(((String) get("activeSttRequestId")).isEmpty());
        assertEquals("", get("microphoneRequestId"));
        Notification notification = (Notification) invoke("buildNotification", new Class<?>[] {String.class},
            AssistantVoiceRuntimeService.STATE_LISTENING);
        assertNotNull(notification.actions);
        assertEquals(1, notification.actions.length);
        assertEquals(service.getString(R.string.assistant_voice_notification_action_stop), notification.actions[0].title);
        invoke("stopCurrentInteraction", new Class<?>[] {boolean.class, String.class}, false, "manual_stop");
        assertEquals("", get("activeSttRequestId"));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("", get("activeSttRequestId"));
    }

    @Test public void realtimeIdleKeepsMissingSpeechTokenErrorQuietUntilExplicitPlay() throws Exception {
        AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
        set("speechReady", false);
        long errorsBefore = runtimeErrorBroadcastCount();
        invoke("applyConfig", new Class<?>[] {AssistantVoiceConfig.class},
            config.withVoiceSettings(new JSONObject().put("voiceRuntimeMode", "realtime")));
        assertEquals(AssistantVoiceRuntimeService.STATE_IDLE, get("runtimeState"));
        assertEquals("Save a speech server token in Voice settings", get("speechSetupError"));
        assertNull(get("speechClient"));
        assertTrue((Boolean) get("speechCredentialLoaded"));
        assertEquals(errorsBefore, runtimeErrorBroadcastCount());
        invoke("connectSpeechIfNeeded", new Class<?>[0]);
        assertEquals(errorsBefore, runtimeErrorBroadcastCount());
        service.onStartCommand(AssistantVoiceRuntimeService.playTextIntent(service,
            "session-current", "Hello", "Play", "unready-play"), 0, 1);
        assertEquals(errorsBefore + 1, runtimeErrorBroadcastCount());
        assertEquals(AssistantVoiceRuntimeService.STATE_IDLE, get("runtimeState"));
        assertEquals(1, queue().size());
        queue().clear();
        invoke("applyConfig", new Class<?>[] {AssistantVoiceConfig.class}, config);
        assertEquals(AssistantVoiceRuntimeService.STATE_ERROR, get("runtimeState"));
        assertEquals("Save a speech server token in Voice settings", get("speechSetupError"));
        assertEquals(errorsBefore + 2, runtimeErrorBroadcastCount());
    }

    @Test public void realtimePreferenceAllowsQueuedPlayOnceLiveRealtimeOwnerReleasesAdmission() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(AssistantSpeechClientTest.capabilities(2880000, 20));
            server.enqueue(AssistantSpeechClientTest.capabilities(2880000, 20));
            server.enqueue(new MockResponse().setResponseCode(503));
            AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
            set("config", config.withVoiceSettings(new JSONObject()
                .put("voiceRuntimeMode", "realtime")
                .put("speechServerBaseUrl", server.url("/speech/v1").toString())
                .put("speechRecognitionModel", "asr").put("speechSynthesisModel", "tts").put("speechVoice", "voice")));
            set("speechReady", false);
            set("speechCredential", "loaded-token");
            set("speechCredentialLoaded", true);
            invoke("connectSpeechIfNeeded", new Class<?>[0]);
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
            waitUntil(() -> fieldEquals("speechReady", true));
            assertEquals(AssistantVoiceRuntimeService.STATE_IDLE, get("runtimeState"));
            AssistantSpeechClient connected = (AssistantSpeechClient) get("speechClient");
            set("liveOwner", AssistantVoiceControllerPolicy.OWNER_REALTIME);
            set("runtimeState", AssistantVoiceRuntimeService.STATE_REALTIME_ACTIVE);
            service.pauseThreadAdmission();
            service.onStartCommand(AssistantVoiceRuntimeService.playTextIntent(service,
                "session-current", "Hello", "Play", "queued-realtime-play"), 0, 1);
            assertEquals(1, queue().size());
            assertEquals("", get("activeTtsRequestId"));
            assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS));
            set("liveOwner", AssistantVoiceControllerPolicy.OWNER_THREAD);
            set("runtimeState", AssistantVoiceRuntimeService.STATE_IDLE);
            service.resumeThreadAdmission();
            assertTrue(queue().isEmpty());
            assertEquals(AssistantVoiceRuntimeService.STATE_SPEAKING, get("runtimeState"));
            assertFalse(((String) get("activeTtsRequestId")).isEmpty());
            assertEquals("queued-realtime-play", ((AssistantVoiceQueueItem) get("activeQueueItem")).sourceEventId);
            assertSame(connected, get("speechClient"));
            assertEquals("/speech/v1/audio/capabilities", server.takeRequest(5, TimeUnit.SECONDS).getPath());
            assertEquals("/speech/v1/audio/speech", server.takeRequest(5, TimeUnit.SECONDS).getPath());
            waitUntil(() -> fieldEquals("activeTtsRequestId", ""));
            invoke("disconnectSpeech", new Class<?>[0]);
        }
    }

    @Test public void manualPlayDuringInitialDiscoveryQueuesWithoutAnError() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
            configurePendingDiscovery(server);
            long errorsBefore = runtimeErrorBroadcastCount();
            service.onStartCommand(AssistantVoiceRuntimeService.playTextIntent(service,
                "session-current", "Hello", "Play", "cold-play"), 0, 1);
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
            assertNotNull(get("speechClient"));
            assertEquals(1, queue().size());
            assertEquals("cold-play", queue().get(0).sourceEventId);
            assertEquals("", get("activeTtsRequestId"));
            assertEquals(errorsBefore, runtimeErrorBroadcastCount());
            assertEquals("", AssistantVoiceConfig.loadRuntimeError(service));
            invoke("disconnectSpeech", new Class<?>[0]);
        }
    }

    @Test public void newModelDiscoveryClearsOldSetupErrorAndQueuesManualPlayQuietly() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
            configurePendingDiscovery(server);
            invoke("reportSpeechSetupError", new Class<?>[] {String.class},
                "Selected speech models or voice are unavailable");
            long errorsBefore = runtimeErrorBroadcastCount();
            assertEquals("Selected speech models or voice are unavailable", AssistantVoiceConfig.loadRuntimeError(service));
            AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
            invoke("applyConfig", new Class<?>[] {AssistantVoiceConfig.class},
                config.withVoiceSettings(new JSONObject().put("speechRecognitionModel", "new-asr")));
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
            assertNotNull(get("speechClient"));
            assertEquals("", get("speechSetupError"));
            assertEquals("", get("reportedSpeechSetupError"));
            assertEquals(AssistantVoiceRuntimeService.STATE_CONNECTING, get("runtimeState"));
            service.onStartCommand(AssistantVoiceRuntimeService.playTextIntent(service,
                "session-current", "Hello", "Play", "new-model-play"), 0, 1);
            assertEquals(1, queue().size());
            assertEquals(errorsBefore, runtimeErrorBroadcastCount());
            assertEquals("", AssistantVoiceConfig.loadRuntimeError(service));
            invoke("disconnectSpeech", new Class<?>[0]);
        }
    }

    @Test public void unavailableCatalogRetriesQuietlyAndRecoversWhenRecognitionAloneBecomesReady() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            JSONObject unavailable = AssistantSpeechClientTest.listing(2880000, 20);
            unavailable.getJSONArray("data").getJSONObject(0).put("ready", false);
            unavailable.getJSONArray("data").getJSONObject(1).put("ready", false);
            server.enqueue(new MockResponse().setBody(unavailable.toString()));
            server.enqueue(new MockResponse().setBody(unavailable.toString()));
            JSONObject recognitionOnly = AssistantSpeechClientTest.listing(2880000, 20);
            recognitionOnly.getJSONArray("data").getJSONObject(1).put("ready", false);
            server.enqueue(new MockResponse().setBody(recognitionOnly.toString()));
            AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
            set("config", config.withVoiceSettings(new JSONObject()
                .put("speechServerBaseUrl", server.url("/speech/v1").toString())
                .put("speechRecognitionModel", "asr").put("speechSynthesisModel", "tts").put("speechVoice", "voice")));
            set("speechReady", false);
            set("speechCredential", "loaded-token");
            set("speechCredentialLoaded", true);
            long errorsBefore = runtimeErrorBroadcastCount();
            invoke("connectSpeechIfNeeded", new Class<?>[0]);
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
            waitUntil(() -> fieldEquals("runtimeState", AssistantVoiceRuntimeService.STATE_ERROR));
            assertEquals(errorsBefore + 1, runtimeErrorBroadcastCount());
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30));
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
            waitUntil(() -> fieldEquals("speechClient", null));
            assertEquals(errorsBefore + 1, runtimeErrorBroadcastCount());
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30));
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
            waitUntil(() -> fieldEquals("speechReady", true));
            assertEquals(AssistantVoiceRuntimeService.STATE_IDLE, get("runtimeState"));
            assertEquals("", get("speechSetupError"));
            assertEquals("loaded-token", get("speechCredential"));
            invoke("disconnectSpeech", new Class<?>[0]);
        }
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

    private long runtimeErrorBroadcastCount() {
        return Shadows.shadowOf(RuntimeEnvironment.getApplication()).getBroadcastIntents().stream()
            .filter(intent -> AssistantVoiceRuntimeService.BROADCAST_RUNTIME_ERROR.equals(intent.getAction())).count();
    }

    private void configurePendingDiscovery(MockWebServer server) throws Exception {
        AssistantVoiceConfig config = (AssistantVoiceConfig) get("config");
        set("config", config.withVoiceSettings(new JSONObject()
            .put("speechServerBaseUrl", server.url("/speech/v1").toString())
            .put("speechRecognitionModel", "asr").put("speechSynthesisModel", "tts").put("speechVoice", "voice")));
        set("speechReady", false);
        set("speechCredential", "loaded-token");
        set("speechCredentialLoaded", true);
    }

    private boolean fieldEquals(String name, Object expected) {
        try { return java.util.Objects.equals(expected, get(name)); }
        catch (Exception error) { throw new AssertionError(error); }
    }

    private void waitUntil(BooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        do {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            if (condition.getAsBoolean()) return;
            Thread.sleep(10);
        } while (System.nanoTime() < deadline);
        fail("Runtime did not process its speech discovery callback");
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
