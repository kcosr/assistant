package com.assistant.mobile.voice;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;
import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.DataChannel;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.audio.JavaAudioDeviceModule;

import java.io.IOException;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Android Realtime WebRTC client: empty ICE servers, non-trickle gather-once offer,
 * server-proxied SDP answer via Assistant /api/voice.
 */
final class AssistantVoiceRealtimeClient {
    private static final String TAG = "AssistantVoiceRealtime";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final long ICE_GATHER_TIMEOUT_MS = 8_000L;
    private static final long HEARTBEAT_INTERVAL_MS = 15_000L;
    private static final long EVENTS_POLL_INTERVAL_MS = 1_500L;

    interface Listener {
        void onConnecting();
        void onConnected(String sessionId, String conversationId);
        void onFailed(String message);
        void onClosed(String reason);
        void onTranscript(String role, String text, boolean isFinal);
        void onTool(String name, String status, String detail);
    }

    private final Context appContext;
    private final OkHttpClient httpClient;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    /** True while a call is fully torn down / not reusable until the next start resets it. */
    private final AtomicBoolean terminal = new AtomicBoolean(true);
    private static final AtomicBoolean FACTORY_INITIALIZED = new AtomicBoolean(false);

    private Listener listener;
    private PeerConnectionFactory factory;
    private JavaAudioDeviceModule audioDeviceModule;
    private PeerConnection peerConnection;
    private AudioTrack localAudioTrack;
    private AudioSource audioSource;
    private String assistantBaseUrl = "";
    private String sessionId = "";
    private String conversationId = "";
    private boolean muted = false;
    private long eventCursor = 0L;
    private final Runnable heartbeatRunnable = this::heartbeatOnce;
    private final Runnable eventsPollRunnable = this::pollEventsOnce;

    AssistantVoiceRealtimeClient(Context context, OkHttpClient httpClient) {
        this.appContext = context.getApplicationContext();
        this.httpClient = httpClient;
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    void start(
        String assistantBaseUrl,
        String conversationId,
        String listsInstanceId,
        boolean muteOnStart,
        long ownerGeneration,
        AssistantVoiceAudioRouter audioRouter
    ) {
        executor.execute(() -> {
            try {
                // Previous stop() leaves terminal=true and may leave WebRTC resources half-torn.
                // Always fully clean and re-arm before starting a new call on the same client.
                cleanupMedia("restart_cleanup", false, false);
                terminal.set(false);
                sessionId = "";
                this.conversationId = "";
                eventCursor = 0L;
                startLocked(
                    assistantBaseUrl,
                    conversationId,
                    listsInstanceId,
                    muteOnStart,
                    ownerGeneration,
                    audioRouter
                );
            } catch (Exception error) {
                Log.w(TAG, "realtime start failed", error);
                fail(error.getMessage() == null ? "realtime_start_failed" : error.getMessage());
            }
        });
    }

    void setMuted(boolean muted) {
        executor.execute(() -> {
            this.muted = muted;
            if (localAudioTrack != null) {
                localAudioTrack.setEnabled(!muted);
            }
            if (!sessionId.isEmpty()) {
                try {
                    JSONObject body = new JSONObject();
                    body.put("muted", muted);
                    postJson(
                        AssistantVoiceUrlUtils.assistantVoiceSessionMuteUrl(assistantBaseUrl, sessionId),
                        body
                    );
                } catch (Exception error) {
                    Log.w(TAG, "setMuted request failed", error);
                }
            }
        });
    }

    void stop(String reason) {
        stop(reason, true);
    }

    /**
     * @param notifyListener when false, suppresses {@link Listener#onClosed} so a recovery
     *     restart can tear down media without the service treating the close as end-of-call.
     */
    void stop(String reason, boolean notifyListener) {
        executor.execute(
            () ->
                cleanupMedia(
                    reason == null ? "client_stop" : reason,
                    true,
                    notifyListener
                )
        );
    }

    void release() {
        executor.execute(() -> cleanupMedia("release", true, false));
        executor.shutdownNow();
    }

    private void startLocked(
        String baseUrl,
        String requestedConversationId,
        String listsInstanceId,
        boolean muteOnStart,
        long ownerGeneration,
        AssistantVoiceAudioRouter audioRouter
    ) throws Exception {
        if (terminal.get()) {
            // Should not happen after start() re-arms terminal=false; treat as hard failure.
            throw new IllegalStateException("realtime_client_terminal");
        }
        notifyConnecting();
        this.assistantBaseUrl = AssistantVoiceUrlUtils.normalizeBaseUrl(
            baseUrl,
            AssistantVoiceConfig.DEFAULT_ASSISTANT_BASE_URL
        );
        this.muted = muteOnStart;

        if (audioRouter != null) {
            // Drop any stale focus/mode from a previous call before re-requesting.
            audioRouter.releaseAll(0L);
            boolean focusGranted = audioRouter.requestRealtimeFocus(ownerGeneration);
            if (!focusGranted) {
                throw new IllegalStateException("audio_focus_denied");
            }
            audioRouter.enterCommunicationMode(ownerGeneration);
        }

        JSONObject createBody = new JSONObject();
        if (requestedConversationId != null && !requestedConversationId.trim().isEmpty()) {
            createBody.put("conversationId", requestedConversationId.trim());
        }
        if (listsInstanceId != null && !listsInstanceId.trim().isEmpty()) {
            createBody.put("listsInstanceId", listsInstanceId.trim());
        }
        JSONObject created = postJson(
            AssistantVoiceUrlUtils.assistantVoiceSessionsUrl(assistantBaseUrl),
            createBody
        );
        sessionId = created.optString("sessionId", "");
        conversationId = created.optString("conversationId", "");
        if (sessionId.isEmpty()) {
            throw new IllegalStateException("voice_session_create_failed");
        }

        ensureFactory();
        PeerConnection.RTCConfiguration rtcConfig =
            new PeerConnection.RTCConfiguration(Collections.emptyList());
        rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        peerConnection = factory.createPeerConnection(rtcConfig, new PeerObserver());
        if (peerConnection == null) {
            throw new IllegalStateException("peer_connection_create_failed");
        }

        MediaConstraints audioConstraints = new MediaConstraints();
        audioSource = factory.createAudioSource(audioConstraints);
        localAudioTrack = factory.createAudioTrack("assistant-audio", audioSource);
        localAudioTrack.setEnabled(!muted);
        peerConnection.addTrack(localAudioTrack);

        // Data channel for provider events is optional; server sideband owns tools.
        peerConnection.createDataChannel("oai-events", new DataChannel.Init());

        CountDownLatch gatherLatch = new CountDownLatch(1);
        AtomicBoolean gatherDone = new AtomicBoolean(false);
        peerConnection.createOffer(
            new SdpObserverAdapter() {
                @Override
                public void onCreateSuccess(SessionDescription sessionDescription) {
                    peerConnection.setLocalDescription(
                        new SdpObserverAdapter() {
                            @Override
                            public void onSetSuccess() {
                                // wait for ICE gathering complete
                            }
                        },
                        sessionDescription
                    );
                }
            },
            new MediaConstraints()
        );

        long deadline = System.currentTimeMillis() + ICE_GATHER_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            PeerConnection.IceGatheringState state = peerConnection.iceGatheringState();
            if (state == PeerConnection.IceGatheringState.COMPLETE) {
                gatherDone.set(true);
                break;
            }
            Thread.sleep(50);
        }
        if (!gatherDone.get() && peerConnection.getLocalDescription() == null) {
            throw new IllegalStateException("ice_gather_timeout");
        }

        SessionDescription local = peerConnection.getLocalDescription();
        if (local == null || local.description == null || local.description.trim().isEmpty()) {
            throw new IllegalStateException("local_sdp_missing");
        }

        JSONObject offerBody = new JSONObject().put("sdp", local.description);
        JSONObject answer = postJson(
            AssistantVoiceUrlUtils.assistantVoiceSessionOfferUrl(assistantBaseUrl, sessionId),
            offerBody
        );
        String answerSdp = answer.optString("sdp", "");
        if (answerSdp.trim().isEmpty()) {
            throw new IllegalStateException("remote_sdp_missing");
        }

        CountDownLatch remoteSet = new CountDownLatch(1);
        AtomicBoolean remoteOk = new AtomicBoolean(false);
        peerConnection.setRemoteDescription(
            new SdpObserverAdapter() {
                @Override
                public void onSetSuccess() {
                    remoteOk.set(true);
                    remoteSet.countDown();
                }

                @Override
                public void onSetFailure(String s) {
                    remoteSet.countDown();
                }
            },
            new SessionDescription(SessionDescription.Type.ANSWER, answerSdp)
        );
        if (!remoteSet.await(5, TimeUnit.SECONDS) || !remoteOk.get()) {
            throw new IllegalStateException("remote_sdp_set_failed");
        }

        notifyConnected(sessionId, conversationId);
        mainHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS);
        mainHandler.postDelayed(eventsPollRunnable, EVENTS_POLL_INTERVAL_MS);
    }

    private void ensureFactory() {
        if (factory != null) {
            return;
        }
        // PeerConnectionFactory.initialize must run only once per process.
        if (FACTORY_INITIALIZED.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(appContext)
                    .createInitializationOptions()
            );
        }
        audioDeviceModule =
            JavaAudioDeviceModule.builder(appContext)
                .setUseHardwareAcousticEchoCanceler(true)
                .setUseHardwareNoiseSuppressor(true)
                .createAudioDeviceModule();
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioDeviceModule)
            .createPeerConnectionFactory();
    }

    private void heartbeatOnce() {
        if (terminal.get() || sessionId.isEmpty()) {
            return;
        }
        executor.execute(() -> {
            try {
                postJson(
                    AssistantVoiceUrlUtils.assistantVoiceSessionHeartbeatUrl(assistantBaseUrl, sessionId),
                    new JSONObject()
                );
            } catch (Exception error) {
                Log.w(TAG, "heartbeat failed", error);
            } finally {
                if (!terminal.get()) {
                    mainHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS);
                }
            }
        });
    }

    private void pollEventsOnce() {
        if (terminal.get() || sessionId.isEmpty()) {
            return;
        }
        executor.execute(() -> {
            try {
                String url = AssistantVoiceUrlUtils.assistantVoiceSessionEventsUrl(
                    assistantBaseUrl,
                    sessionId,
                    eventCursor
                );
                JSONObject payload = getJson(url);
                org.json.JSONArray events = payload.optJSONArray("events");
                if (events != null) {
                    for (int i = 0; i < events.length(); i += 1) {
                        JSONObject event = events.optJSONObject(i);
                        if (event == null) {
                            continue;
                        }
                        long sequence = event.optLong("sequence", 0L);
                        if (sequence > eventCursor) {
                            eventCursor = sequence;
                        }
                        dispatchEvent(event);
                    }
                }
            } catch (Exception error) {
                Log.w(TAG, "events poll failed", error);
            } finally {
                if (!terminal.get()) {
                    mainHandler.postDelayed(eventsPollRunnable, EVENTS_POLL_INTERVAL_MS);
                }
            }
        });
    }

    private void dispatchEvent(JSONObject event) {
        String type = event.optString("type", "");
        if ("transcript".equals(type)) {
            notifyTranscript(
                event.optString("role", "assistant"),
                event.optString("text", ""),
                event.optBoolean("final", true)
            );
        } else if ("tool".equals(type)) {
            notifyTool(
                event.optString("name", ""),
                event.optString("status", ""),
                event.optString("detail", "")
            );
        } else if ("error".equals(type)) {
            // Non-terminal provider error surface; keep call unless session_state fails.
            Log.w(TAG, "realtime event error=" + event.optString("message", ""));
        } else if ("session_state".equals(type)) {
            String state = event.optString("state", "");
            if ("failed".equals(state) || "closed".equals(state)) {
                teardown(event.optString("message", state), false);
            }
        } else if ("closed".equals(type)) {
            teardown(event.optString("reason", "closed"), false);
        }
    }

    private void teardown(String reason, boolean notifyServer) {
        cleanupMedia(reason, notifyServer, true);
    }

    /**
     * Releases WebRTC + session resources so a later start() can succeed.
     *
     * @param notifyServer close the assistant voice session over HTTP when appropriate
     * @param notifyListener fire onClosed once when leaving an active call
     */
    private void cleanupMedia(String reason, boolean notifyServer, boolean notifyListener) {
        boolean wasActive = terminal.compareAndSet(false, true);
        // Always force terminal so a partially-started call cannot leave the client "open".
        terminal.set(true);
        mainHandler.removeCallbacks(heartbeatRunnable);
        mainHandler.removeCallbacks(eventsPollRunnable);

        String closingSessionId = sessionId;
        if (notifyServer && !closingSessionId.isEmpty()) {
            try {
                postJson(
                    AssistantVoiceUrlUtils.assistantVoiceSessionCloseUrl(
                        assistantBaseUrl,
                        closingSessionId
                    ),
                    new JSONObject()
                );
            } catch (Exception ignored) {
            }
        }
        sessionId = "";
        conversationId = "";
        eventCursor = 0L;

        try {
            if (localAudioTrack != null) {
                localAudioTrack.setEnabled(false);
                localAudioTrack.dispose();
            }
        } catch (Exception ignored) {
        }
        localAudioTrack = null;
        try {
            if (audioSource != null) {
                audioSource.dispose();
            }
        } catch (Exception ignored) {
        }
        audioSource = null;
        try {
            if (peerConnection != null) {
                peerConnection.close();
                peerConnection.dispose();
            }
        } catch (Exception ignored) {
        }
        peerConnection = null;
        try {
            if (audioDeviceModule != null) {
                audioDeviceModule.release();
            }
        } catch (Exception ignored) {
        }
        audioDeviceModule = null;
        try {
            if (factory != null) {
                factory.dispose();
            }
        } catch (Exception ignored) {
        }
        factory = null;

        if (notifyListener && wasActive) {
            notifyClosed(reason == null ? "closed" : reason);
        }
    }

    private void fail(String message) {
        // Always notify failure; cleanup may already have been terminal during restart races.
        cleanupMedia(message, true, false);
        Listener current = listener;
        if (current != null) {
            mainHandler.post(() -> current.onFailed(message));
        }
    }

    private void notifyConnecting() {
        Listener current = listener;
        if (current != null) {
            mainHandler.post(current::onConnecting);
        }
    }

    private void notifyConnected(String sessionId, String conversationId) {
        Listener current = listener;
        if (current != null) {
            mainHandler.post(() -> current.onConnected(sessionId, conversationId));
        }
    }

    private void notifyClosed(String reason) {
        Listener current = listener;
        if (current != null) {
            mainHandler.post(() -> current.onClosed(reason));
        }
    }

    private void notifyTranscript(String role, String text, boolean isFinal) {
        Listener current = listener;
        if (current != null) {
            mainHandler.post(() -> current.onTranscript(role, text, isFinal));
        }
    }

    private void notifyTool(String name, String status, String detail) {
        Listener current = listener;
        if (current != null) {
            mainHandler.post(() -> current.onTool(name, status, detail));
        }
    }

    private JSONObject postJson(String url, JSONObject body) throws IOException {
        Request request = new Request.Builder()
            .url(url)
            .post(RequestBody.create(body.toString(), JSON))
            .header("Content-Type", "application/json")
            .build();
        try (Response response = httpClient.newCall(request).execute()) {
            String text = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code() + ": " + text);
            }
            if (text.trim().isEmpty()) {
                return new JSONObject();
            }
            try {
                return new JSONObject(text);
            } catch (Exception error) {
                throw new IOException("Invalid JSON response", error);
            }
        }
    }

    private JSONObject getJson(String url) throws IOException {
        Request request = new Request.Builder().url(url).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            String text = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code() + ": " + text);
            }
            return text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (IOException error) {
            throw error;
        } catch (Exception error) {
            throw new IOException("Invalid JSON response", error);
        }
    }

    private static class SdpObserverAdapter implements SdpObserver {
        @Override
        public void onCreateSuccess(SessionDescription sessionDescription) {}

        @Override
        public void onSetSuccess() {}

        @Override
        public void onCreateFailure(String s) {}

        @Override
        public void onSetFailure(String s) {}
    }

    private class PeerObserver implements PeerConnection.Observer {
        @Override
        public void onSignalingChange(PeerConnection.SignalingState signalingState) {}

        @Override
        public void onIceConnectionChange(PeerConnection.IceConnectionState iceConnectionState) {
            if (iceConnectionState == PeerConnection.IceConnectionState.FAILED
                || iceConnectionState == PeerConnection.IceConnectionState.DISCONNECTED
                || iceConnectionState == PeerConnection.IceConnectionState.CLOSED) {
                executor.execute(() -> {
                    if (!terminal.get()) {
                        // Grace: disconnect may recover briefly; hard-fail on FAILED.
                        if (iceConnectionState == PeerConnection.IceConnectionState.FAILED) {
                            fail("ice_failed");
                        }
                    }
                });
            }
        }

        @Override
        public void onIceConnectionReceivingChange(boolean b) {}

        @Override
        public void onIceGatheringChange(PeerConnection.IceGatheringState iceGatheringState) {}

        @Override
        public void onIceCandidate(IceCandidate iceCandidate) {
            // Non-trickle: candidates are embedded in the gathered local SDP.
        }

        @Override
        public void onIceCandidatesRemoved(IceCandidate[] iceCandidates) {}

        @Override
        public void onAddStream(MediaStream mediaStream) {}

        @Override
        public void onRemoveStream(MediaStream mediaStream) {}

        @Override
        public void onDataChannel(DataChannel dataChannel) {}

        @Override
        public void onRenegotiationNeeded() {}

        @Override
        public void onAddTrack(RtpReceiver rtpReceiver, MediaStream[] mediaStreams) {
            // Remote audio is played by WebRTC ADM automatically when track is received.
        }
    }
}
