package com.assistant.mobile.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.assistant.mobile.MainActivity;
import com.assistant.mobile.R;

import org.json.JSONObject;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class AssistantVoiceRuntimeService extends Service {
    private static final String TAG = "AssistantVoiceRuntime";
    public static final String STATE_DISABLED = "disabled";
    public static final String STATE_CONNECTING = "connecting";
    public static final String STATE_IDLE = "idle";
    public static final String STATE_SPEAKING = "speaking";
    public static final String STATE_LISTENING = "listening";
    public static final String STATE_ERROR = "error";

    static final String ACTION_APPLY_CONFIG = "com.assistant.mobile.voice.APPLY_CONFIG";
    static final String ACTION_STOP_SERVICE = "com.assistant.mobile.voice.STOP_SERVICE";
    static final String ACTION_STOP_CURRENT_INTERACTION = "com.assistant.mobile.voice.STOP_CURRENT_INTERACTION";
    static final String ACTION_START_MANUAL_LISTEN = "com.assistant.mobile.voice.START_MANUAL_LISTEN";

    static final String BROADCAST_STATE_CHANGED = "com.assistant.mobile.voice.STATE_CHANGED";
    static final String BROADCAST_RUNTIME_ERROR = "com.assistant.mobile.voice.RUNTIME_ERROR";
    static final String EXTRA_STATE = "state";
    static final String EXTRA_MESSAGE = "message";

    private static final String NOTIFICATION_CHANNEL_ID = "assistant_voice_mode";
    private static final int NOTIFICATION_ID = 4302;
    private static final long ADAPTER_RECONNECT_DELAY_MS = 2000L;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final OkHttpClient httpClient = new OkHttpClient.Builder()
        .readTimeout(30, TimeUnit.SECONDS)
        .build();
    private final OkHttpClient adapterSocketClient = new OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build();
    private final AssistantVoicePcmPlayer player = new AssistantVoicePcmPlayer();
    private AssistantVoiceMicStreamer micStreamer;

    private final Runnable reconnectRunnable = this::connectAdapterSocketIfNeeded;
    private final Runnable assistantReconnectRunnable = this::connectAssistantSocketIfNeeded;

    private AssistantVoiceConfig config;
    private WebSocket adapterSocket;
    private WebSocket assistantSocket;
    private boolean adapterSocketConnected = false;
    private boolean assistantSocketConnected = false;
    private String adapterClientId = "";
    private String assistantSubscribedSessionId = "";
    private String runtimeState = STATE_DISABLED;

    private String activePromptSessionId = "";
    private String activePromptToolName = "";
    private String activeTtsRequestId = "";
    private String pendingPlaybackDrainRequestId = "";
    private boolean pendingPlaybackDrainStartsListening = false;
    private String activeSttRequestId = "";
    private String adapterStoppedSttRequestId = "";
    private boolean destroyed = false;

    public static Intent applyConfigIntent(Context context, AssistantVoiceConfig config) {
        Intent intent = new Intent(context, AssistantVoiceRuntimeService.class);
        intent.setAction(ACTION_APPLY_CONFIG);
        return config.applyToIntent(intent);
    }

    public static Intent stopServiceIntent(Context context) {
        return new Intent(context, AssistantVoiceRuntimeService.class).setAction(ACTION_STOP_SERVICE);
    }

    public static Intent stopCurrentInteractionIntent(Context context) {
        return new Intent(context, AssistantVoiceRuntimeService.class)
            .setAction(ACTION_STOP_CURRENT_INTERACTION);
    }

    public static Intent startManualListenIntent(Context context) {
        return new Intent(context, AssistantVoiceRuntimeService.class)
            .setAction(ACTION_START_MANUAL_LISTEN);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        micStreamer = new AssistantVoiceMicStreamer(this);
        config = AssistantVoiceConfig.load(this);
        micStreamer.setPreferredDeviceId(config.selectedMicDeviceId);
        player.setListener(requestId -> mainHandler.post(() -> handlePlaybackDrained(requestId)));
        createNotificationChannel();
        startInForeground();
        if (!config.isEnabled()) {
            updateState(STATE_DISABLED, null);
            stopSelf();
            return;
        }
        updateState(STATE_CONNECTING, null);
        connectAdapterSocketIfNeeded();
        connectAssistantSocketIfNeeded();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_STOP_SERVICE.equals(action)) {
            updateState(STATE_DISABLED, null);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP_CURRENT_INTERACTION.equals(action)) {
            stopCurrentInteraction(isPromptPlaybackActive(), "manual_stop");
            return START_STICKY;
        }
        if (ACTION_START_MANUAL_LISTEN.equals(action)) {
            startManualListen();
            return START_STICKY;
        }
        if (ACTION_APPLY_CONFIG.equals(action)) {
            AssistantVoiceConfig updated = AssistantVoiceConfig.fromIntent(intent, config);
            applyConfig(updated);
            return START_STICKY;
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        mainHandler.removeCallbacksAndMessages(null);
        stopCurrentInteraction(false, "service_destroy");
        disconnectAdapterSocket();
        disconnectAssistantSocket();
        player.release();
        if (micStreamer != null) {
            micStreamer.release();
        }
        networkExecutor.shutdownNow();
        httpClient.dispatcher().cancelAll();
        httpClient.dispatcher().executorService().shutdownNow();
        adapterSocketClient.dispatcher().cancelAll();
        adapterSocketClient.dispatcher().executorService().shutdownNow();
        updateState(STATE_DISABLED, null);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void applyConfig(AssistantVoiceConfig updated) {
        AssistantVoiceConfig previous = config;
        config = updated;
        AssistantVoiceConfig.save(this, updated);
        if (micStreamer != null) {
            micStreamer.setPreferredDeviceId(updated.selectedMicDeviceId);
        }

        boolean sessionChanged = !previous.selectedSessionId.equals(updated.selectedSessionId)
            || !previous.selectedPanelId.equals(updated.selectedPanelId);
        boolean adapterUrlChanged = !previous.voiceAdapterBaseUrl.equals(updated.voiceAdapterBaseUrl);
        boolean assistantUrlChanged = !previous.assistantBaseUrl.equals(updated.assistantBaseUrl);

        if (!updated.isEnabled()) {
            stopCurrentInteraction(false, "voice_mode_disabled");
            disconnectAdapterSocket();
            disconnectAssistantSocket();
            updateState(STATE_DISABLED, null);
            stopSelf();
            return;
        }

        startInForeground();

        if (sessionChanged || adapterUrlChanged || assistantUrlChanged) {
            stopCurrentInteraction(false, sessionChanged ? "session_changed" : "config_changed");
        }

        if (adapterUrlChanged) {
            disconnectAdapterSocket();
        }

        if (assistantUrlChanged) {
            disconnectAssistantSocket();
        } else if (sessionChanged) {
            syncAssistantSessionSubscription(previous.selectedSessionId, updated.selectedSessionId);
        }

        if (!adapterSocketConnected) {
            updateState(STATE_CONNECTING, null);
            connectAdapterSocketIfNeeded();
        }

        if (!assistantSocketConnected) {
            updateState(STATE_CONNECTING, null);
            connectAssistantSocketIfNeeded();
        } else if (!hasActiveInteraction()) {
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
        }
    }

    private void startInForeground() {
        Notification notification = buildNotification(runtimeState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(String state) {
        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent launchPendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        return new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.assistant_voice_notification_title))
            .setContentText(getString(R.string.assistant_voice_notification_text, state))
            .setContentIntent(launchPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.assistant_voice_notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.assistant_voice_notification_channel_description));
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private void connectAdapterSocketIfNeeded() {
        if (destroyed || !config.isEnabled() || adapterSocket != null) {
            return;
        }
        mainHandler.removeCallbacks(reconnectRunnable);
        updateState(hasActiveInteraction() ? runtimeState : STATE_CONNECTING, null);
        Request request = new Request.Builder()
            .url(AssistantVoiceUrlUtils.adapterWebSocketUrl(config.voiceAdapterBaseUrl))
            .build();
        adapterSocket = adapterSocketClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                mainHandler.post(() -> {
                    if (adapterSocket != webSocket || destroyed) {
                        return;
                    }
                    adapterSocketConnected = true;
                    sendAdapterClientState();
                    if (!hasActiveInteraction() && isRuntimeConnected()) {
                        updateState(STATE_IDLE, null);
                    }
                });
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                mainHandler.post(() -> handleAdapterMessage(webSocket, text));
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                mainHandler.post(() -> handleAdapterSocketClosed(webSocket, "closed"));
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                mainHandler.post(() -> handleAdapterSocketClosed(
                    webSocket,
                    t == null ? "adapter_connection_failed" : t.getMessage()
                ));
            }
        });
    }

    private void disconnectAdapterSocket() {
        mainHandler.removeCallbacks(reconnectRunnable);
        WebSocket socket = adapterSocket;
        adapterSocket = null;
        adapterSocketConnected = false;
        adapterClientId = "";
        if (socket != null) {
            socket.close(1000, "config update");
        }
    }

    private void handleAdapterSocketClosed(WebSocket webSocket, String reason) {
        if (adapterSocket != webSocket) {
            return;
        }
        adapterSocket = null;
        adapterSocketConnected = false;
        adapterClientId = "";
        if (config.isEnabled() && !destroyed) {
            stopCurrentInteraction(false, "adapter_disconnect");
            updateState(STATE_CONNECTING, reason);
            mainHandler.removeCallbacks(reconnectRunnable);
            mainHandler.postDelayed(reconnectRunnable, ADAPTER_RECONNECT_DELAY_MS);
        }
    }

    private void connectAssistantSocketIfNeeded() {
        if (destroyed || !config.isEnabled() || assistantSocket != null) {
            return;
        }

        mainHandler.removeCallbacks(assistantReconnectRunnable);
        if (!hasActiveInteraction()) {
            updateState(STATE_CONNECTING, null);
        }

        Request request = new Request.Builder()
            .url(AssistantVoiceUrlUtils.assistantWebSocketUrl(config.assistantBaseUrl))
            .build();
        assistantSocket = adapterSocketClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                mainHandler.post(() -> {
                    if (assistantSocket != webSocket || destroyed) {
                        return;
                    }
                    assistantSocketConnected = true;
                    assistantSubscribedSessionId = "";
                    webSocket.send(
                        AssistantVoiceSessionSocketProtocol.buildHelloMessage(config.selectedSessionId)
                    );
                    if (!hasActiveInteraction() && isRuntimeConnected()) {
                        updateState(STATE_IDLE, null);
                    }
                });
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                mainHandler.post(() -> handleAssistantSocketMessage(webSocket, text));
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                mainHandler.post(() -> handleAssistantSocketClosed(webSocket, "closed"));
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                mainHandler.post(() -> handleAssistantSocketClosed(
                    webSocket,
                    t == null ? "assistant_connection_failed" : t.getMessage()
                ));
            }
        });
    }

    private void disconnectAssistantSocket() {
        mainHandler.removeCallbacks(assistantReconnectRunnable);
        WebSocket socket = assistantSocket;
        assistantSocket = null;
        assistantSocketConnected = false;
        assistantSubscribedSessionId = "";
        if (socket != null) {
            socket.close(1000, "config update");
        }
    }

    private void handleAssistantSocketClosed(WebSocket webSocket, String reason) {
        if (assistantSocket != webSocket) {
            return;
        }
        assistantSocket = null;
        assistantSocketConnected = false;
        assistantSubscribedSessionId = "";
        if (config.isEnabled() && !destroyed) {
            if (!hasActiveInteraction()) {
                updateState(STATE_CONNECTING, reason);
            }
            mainHandler.removeCallbacks(assistantReconnectRunnable);
            mainHandler.postDelayed(assistantReconnectRunnable, ADAPTER_RECONNECT_DELAY_MS);
        }
    }

    private void handleAssistantSocketMessage(WebSocket webSocket, String rawText) {
        if (assistantSocket != webSocket || destroyed) {
            return;
        }

        String subscribedSessionId =
            AssistantVoiceSessionSocketProtocol.parseSubscriptionSessionId(rawText, "subscribed");
        if (!subscribedSessionId.isEmpty()) {
            assistantSubscribedSessionId = subscribedSessionId;
            if (!hasActiveInteraction() && isRuntimeConnected()) {
                updateState(STATE_IDLE, null);
            }
            return;
        }

        String unsubscribedSessionId =
            AssistantVoiceSessionSocketProtocol.parseSubscriptionSessionId(rawText, "unsubscribed");
        if (!unsubscribedSessionId.isEmpty() && unsubscribedSessionId.equals(assistantSubscribedSessionId)) {
            assistantSubscribedSessionId = "";
            return;
        }

        AssistantVoicePromptEvent prompt =
            AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(rawText, config.selectedSessionId);
        if (prompt == null) {
            return;
        }
        if (
            AssistantVoiceInteractionRules.shouldAutoplayEvent(
                config.audioMode,
                config.selectedSessionId,
                prompt,
                !hasActiveInteraction()
            )
        ) {
            beginPromptPlayback(prompt);
        }
    }

    private void syncAssistantSessionSubscription(String previousSessionId, String nextSessionId) {
        if (!assistantSocketConnected || assistantSocket == null) {
            assistantSubscribedSessionId = "";
            return;
        }

        String previous = trim(previousSessionId);
        String next = trim(nextSessionId);
        if (previous.equals(next)) {
            return;
        }
        if (!previous.isEmpty()) {
            assistantSocket.send(AssistantVoiceSessionSocketProtocol.buildUnsubscribeMessage(previous));
            if (previous.equals(assistantSubscribedSessionId)) {
                assistantSubscribedSessionId = "";
            }
        }
        if (!next.isEmpty()) {
            assistantSocket.send(AssistantVoiceSessionSocketProtocol.buildSubscribeMessage(next));
        }
    }

    private void sendAdapterClientState() {
        if (!adapterSocketConnected || adapterSocket == null) {
            return;
        }
        JSONObject payload = new JSONObject();
        putJson(payload, "type", "client_state_update");
        putJson(payload, "acceptingTurns", false);
        putJson(payload, "speechEnabled", true);
        putJson(payload, "listeningEnabled", false);
        putJson(payload, "inTurn", false);
        putJson(payload, "turnModeEnabled", false);
        putJson(payload, "directTtsEnabled", true);
        putJson(payload, "directSttEnabled", true);
        adapterSocket.send(payload.toString());
    }

    private void handleAdapterMessage(WebSocket webSocket, String rawText) {
        if (adapterSocket != webSocket || destroyed) {
            return;
        }
        try {
            JSONObject message = new JSONObject(rawText);
            String type = message.optString("type");
            if ("client_identity".equals(type)) {
                adapterClientId = trim(message.optString("clientId"));
                if (!hasActiveInteraction()) {
                    updateState(STATE_IDLE, null);
                }
                return;
            }
            if ("media_tts_audio_chunk".equals(type)) {
                String requestId = trim(message.optString("requestId"));
                if (requestId.equals(activeTtsRequestId)) {
                    player.enqueueChunk(
                        requestId,
                        message.optString("chunkBase64"),
                        message.optInt("sampleRate", 24000)
                    );
                }
                return;
            }
            if ("media_tts_end".equals(type)) {
                handleTtsEnd(message);
                return;
            }
            if ("media_stt_stopped".equals(type)) {
                String requestId = trim(message.optString("requestId"));
                Log.d(TAG, "adapter media_stt_stopped requestId=" + requestId + " active=" + activeSttRequestId);
                if (requestId.equals(activeSttRequestId) && micStreamer != null) {
                    adapterStoppedSttRequestId = requestId;
                    micStreamer.stop(requestId);
                }
                return;
            }
            if ("media_stt_result".equals(type)) {
                Log.d(
                    TAG,
                    "adapter media_stt_result requestId=" + trim(message.optString("requestId"))
                        + " active=" + activeSttRequestId
                        + " success=" + message.optBoolean("success", false)
                        + " error=" + trim(message.optString("error"))
                );
                handleSttResult(message);
            }
        } catch (Exception error) {
            emitRuntimeError("Invalid adapter response");
        }
    }

    private void handleTtsEnd(JSONObject message) {
        String requestId = trim(message.optString("requestId"));
        if (!requestId.equals(activeTtsRequestId)) {
            return;
        }
        String status = trim(message.optString("status"));
        boolean startsListening = AssistantVoiceInteractionRules.shouldStartRecognitionAfterPlayback(
            activePromptToolName,
            config.autoListenEnabled
        );
        activeTtsRequestId = "";

        if ("completed".equals(status)) {
            pendingPlaybackDrainRequestId = requestId;
            pendingPlaybackDrainStartsListening = startsListening;
            player.finishStream(requestId);
            return;
        }

        player.stop();
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        clearActivePromptContext();
        if ("failed".equals(status)) {
            emitRuntimeError("Voice playback failed");
        }
        if (!hasActiveInteraction()) {
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
        }
    }

    private void handlePlaybackDrained(String requestId) {
        if (!requestId.equals(pendingPlaybackDrainRequestId)) {
            return;
        }
        boolean shouldStartListening = pendingPlaybackDrainStartsListening;
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        if (shouldStartListening) {
            startRecognition(activePromptSessionId, "playback_completion");
            return;
        }
        clearActivePromptContext();
        if (!hasActiveInteraction()) {
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
        }
    }

    private void handleSttResult(JSONObject message) {
        String requestId = trim(message.optString("requestId"));
        if (!requestId.equals(activeSttRequestId)) {
            Log.d(TAG, "ignoring media_stt_result requestId=" + requestId + " active=" + activeSttRequestId);
            return;
        }

        String sessionId = activePromptSessionId;
        activeSttRequestId = "";
        if (micStreamer != null) {
            adapterStoppedSttRequestId = requestId;
            micStreamer.stop(requestId);
        }

        boolean success = message.optBoolean("success", false);
        boolean canceled = message.optBoolean("canceled", false);
        String text = trim(message.optString("text"));
        String error = trim(message.optString("error"));
        int durationMs = Math.max(0, message.optInt("durationMs", 0));

        Log.d(
            TAG,
            "handleSttResult requestId=" + requestId
                + " success=" + success
                + " canceled=" + canceled
                + " textLength=" + text.length()
                + " durationMs=" + durationMs
                + " sessionId=" + sessionId
                + " error=" + error
        );

        clearActivePromptContext();
        if (!hasActiveInteraction()) {
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
        }

        if (success && !text.isEmpty() && !sessionId.isEmpty()) {
            submitRecognizedSpeech(sessionId, text, durationMs);
            return;
        }
        if (!canceled) {
            emitRuntimeError(describeSttFailure(error));
        }
    }

    private String describeSttFailure(String error) {
        if (error == null) {
            return "Voice recognition failed";
        }
        switch (error.trim()) {
            case "empty_transcript":
                return "Voice recognition returned an empty transcript";
            case "no_usable_speech":
                return "Voice recognition did not detect usable speech";
            case "Recognition audio payload is empty":
                return "Voice recognition captured empty audio";
            case "canceled":
                return "Voice recognition was canceled";
            default:
                return error.trim().isEmpty() ? "Voice recognition failed" : "Voice recognition failed: " + error.trim();
        }
    }

    private void beginPromptPlayback(AssistantVoicePromptEvent prompt) {
        if (!config.isEnabled() || prompt == null || hasActiveInteraction()) {
            return;
        }
        if (!prompt.sessionId.equals(config.selectedSessionId)) {
            return;
        }
        if (!adapterSocketConnected || adapterClientId.isEmpty()) {
            return;
        }

        String requestId = UUID.randomUUID().toString();
        activePromptSessionId = prompt.sessionId;
        activePromptToolName = prompt.toolName;
        activeTtsRequestId = requestId;
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        player.startStream(requestId);
        updateState(STATE_SPEAKING, null);

        networkExecutor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("clientId", adapterClientId);
                body.put("requestId", requestId);
                body.put("text", prompt.text);
                postJson(AssistantVoiceUrlUtils.adapterTtsUrl(config.voiceAdapterBaseUrl), body);
            } catch (Exception error) {
                mainHandler.post(() -> {
                    if (!requestId.equals(activeTtsRequestId)) {
                        return;
                    }
                    activeTtsRequestId = "";
                    clearActivePromptContext();
                    player.stop();
                    updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
                    emitRuntimeError("Voice playback request failed");
                });
            }
        });
    }

    private void stopCurrentInteraction(boolean transitionToRecognition, String reason) {
        String ttsRequestId = activeTtsRequestId;
        String listeningRequestId = activeSttRequestId;
        String speakingSessionId = activePromptSessionId;
        String speakingToolName = activePromptToolName;

        activeTtsRequestId = "";
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        player.stop();

        if (!ttsRequestId.isEmpty()) {
            requestAdapterTtsStop(ttsRequestId);
        }

        if (!listeningRequestId.isEmpty()) {
            activeSttRequestId = "";
            if (micStreamer != null) {
                micStreamer.stop(listeningRequestId);
            }
            sendAdapterSttCancel(listeningRequestId);
        }

        if (transitionToRecognition && !speakingSessionId.isEmpty()) {
            boolean allowPromptFollowup = AssistantVoiceInteractionRules
                .shouldStartRecognitionAfterManualStop(
                    speakingToolName,
                    "manual_listen".equals(reason),
                    config.autoListenEnabled
                );
            if (allowPromptFollowup) {
                startRecognition(speakingSessionId, reason);
                return;
            }
        }

        clearActivePromptContext();
        if (!hasActiveInteraction()) {
            updateState(config.isEnabled() && isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
        }
    }

    private void startManualListen() {
        if (!config.isEnabled() || config.selectedSessionId.isEmpty()) {
            return;
        }
        if (isPromptPlaybackActive()) {
            stopCurrentInteraction(true, "manual_listen");
            return;
        }
        if (!activeSttRequestId.isEmpty()) {
            return;
        }
        startRecognition(config.selectedSessionId, "manual_listen");
    }

    private void startRecognition(String sessionId, String reason) {
        if (sessionId == null || sessionId.trim().isEmpty()) {
            return;
        }
        if (!config.isEnabled() || !adapterSocketConnected || adapterSocket == null) {
            updateState(STATE_CONNECTING, null);
            return;
        }
        if (!activeSttRequestId.isEmpty()) {
            return;
        }

        String requestId = UUID.randomUUID().toString();
        activePromptSessionId = sessionId.trim();
        activePromptToolName = "manual_listen".equals(reason) ? "voice_manual" : activePromptToolName;
        activeSttRequestId = requestId;
        Log.d(TAG, "startRecognition requestId=" + requestId + " sessionId=" + activePromptSessionId + " reason=" + reason);
        updateState(STATE_LISTENING, null);

        if (micStreamer == null) {
            activeSttRequestId = "";
            clearActivePromptContext();
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
            emitRuntimeError("Microphone capture is unavailable");
            return;
        }

        boolean started = micStreamer.start(requestId, new AssistantVoiceMicStreamer.Listener() {
            @Override
            public void onStarted(int sampleRate, int channels, String encoding) {
                JSONObject message = new JSONObject();
                putJson(message, "type", "media_stt_start");
                putJson(message, "requestId", requestId);
                putJson(message, "sampleRate", sampleRate);
                putJson(message, "channels", channels);
                putJson(message, "encoding", encoding);
                putJson(message, "startTimeoutMs", config.recognitionStartTimeoutMs);
                putJson(message, "completionTimeoutMs", config.recognitionCompletionTimeoutMs);
                putJson(message, "endSilenceMs", config.recognitionEndSilenceMs);
                sendAdapterMessage(message);
            }

            @Override
            public void onChunk(byte[] chunk) {
                JSONObject message = new JSONObject();
                putJson(message, "type", "media_stt_chunk");
                putJson(message, "requestId", requestId);
                putJson(
                    message,
                    "chunkBase64",
                    android.util.Base64.encodeToString(chunk, android.util.Base64.NO_WRAP)
                );
                sendAdapterMessage(message);
            }

            @Override
            public void onStopped() {
                mainHandler.post(() -> handleMicCaptureStopped(requestId));
            }
        });

        if (!started) {
            activeSttRequestId = "";
            clearActivePromptContext();
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
            emitRuntimeError("Microphone capture is unavailable");
        }
    }

    private void requestAdapterTtsStop(String requestId) {
        if (!adapterSocketConnected || adapterClientId.isEmpty() || requestId == null || requestId.trim().isEmpty()) {
            return;
        }
        networkExecutor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("clientId", adapterClientId);
                body.put("requestId", requestId);
                postJson(AssistantVoiceUrlUtils.adapterTtsStopUrl(config.voiceAdapterBaseUrl), body);
            } catch (Exception ignored) {
            }
        });
    }

    private void sendAdapterSttCancel(String requestId) {
        if (requestId == null || requestId.trim().isEmpty()) {
            return;
        }
        JSONObject message = new JSONObject();
        putJson(message, "type", "media_stt_cancel");
        putJson(message, "requestId", requestId);
        sendAdapterMessage(message);
    }

    private void sendAdapterSttEnd(String requestId) {
        if (requestId == null || requestId.trim().isEmpty()) {
            return;
        }
        JSONObject message = new JSONObject();
        putJson(message, "type", "media_stt_end");
        putJson(message, "requestId", requestId);
        sendAdapterMessage(message);
    }

    private void sendAdapterMessage(JSONObject message) {
        if (adapterSocketConnected && adapterSocket != null) {
            adapterSocket.send(message.toString());
        }
    }

    private void handleMicCaptureStopped(String requestId) {
        if (requestId != null && requestId.equals(adapterStoppedSttRequestId)) {
            Log.d(TAG, "skip media_stt_end for adapter-stopped requestId=" + requestId);
            adapterStoppedSttRequestId = "";
            return;
        }
        if (!AssistantVoiceInteractionRules.shouldSendSttEndAfterMicStops(activeSttRequestId, requestId)) {
            Log.d(TAG, "skip media_stt_end for inactive requestId=" + requestId + " active=" + activeSttRequestId);
            return;
        }
        Log.d(TAG, "send media_stt_end requestId=" + requestId);
        sendAdapterSttEnd(requestId);
    }

    private void submitRecognizedSpeech(String sessionId, String text, int durationMs) {
        Log.d(TAG, "submitRecognizedSpeech sessionId=" + sessionId + " textLength=" + text.length() + " durationMs=" + durationMs);
        networkExecutor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("sessionId", sessionId);
                body.put("content", text);
                body.put("mode", "async");
                body.put("inputType", "audio");
                body.put("durationMs", durationMs);
                postJson(AssistantVoiceUrlUtils.assistantSessionMessageUrl(config.assistantBaseUrl), body);
            } catch (Exception error) {
                Log.w(TAG, "submitRecognizedSpeech failed", error);
                mainHandler.post(() -> emitRuntimeError("Failed to submit recognized speech"));
            }
        });
    }

    private String postJson(String url, JSONObject body) throws IOException {
        Request request = new Request.Builder()
            .url(url)
            .post(RequestBody.create(body.toString(), JSON))
            .build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }
            if (response.body() == null) {
                return "{}";
            }
            return response.body().string();
        }
    }

    private void clearActivePromptContext() {
        activePromptSessionId = "";
        activePromptToolName = "";
    }

    private boolean hasActiveInteraction() {
        return !activeTtsRequestId.isEmpty() || !activeSttRequestId.isEmpty();
    }

    private boolean isRuntimeConnected() {
        return adapterSocketConnected && assistantSocketConnected;
    }

    private boolean isPromptPlaybackActive() {
        return !activeTtsRequestId.isEmpty() || !pendingPlaybackDrainRequestId.isEmpty();
    }

    private void updateState(String nextState, String maybeErrorMessage) {
        String normalizedState = trim(nextState);
        String normalizedError = trim(maybeErrorMessage);
        if (normalizedState.isEmpty()) {
            normalizedState = STATE_DISABLED;
        }
        if (runtimeState.equals(normalizedState) && normalizedError.isEmpty()) {
            return;
        }
        runtimeState = normalizedState;
        AssistantVoiceConfig.saveRuntimeSnapshot(
            this,
            normalizedState,
            normalizedError.isEmpty() ? null : normalizedError
        );
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(normalizedState));
        }
        Intent stateIntent = new Intent(BROADCAST_STATE_CHANGED);
        stateIntent.setPackage(getPackageName());
        stateIntent.putExtra(EXTRA_STATE, normalizedState);
        sendBroadcast(stateIntent);
        if (!normalizedError.isEmpty()) {
            Intent errorIntent = new Intent(BROADCAST_RUNTIME_ERROR);
            errorIntent.setPackage(getPackageName());
            errorIntent.putExtra(EXTRA_MESSAGE, normalizedError);
            sendBroadcast(errorIntent);
        }
    }

    private void emitRuntimeError(String message) {
        if (message == null || message.trim().isEmpty()) {
            return;
        }
        AssistantVoiceConfig.saveRuntimeSnapshot(this, runtimeState, message);
        Intent errorIntent = new Intent(BROADCAST_RUNTIME_ERROR);
        errorIntent.setPackage(getPackageName());
        errorIntent.putExtra(EXTRA_MESSAGE, message);
        sendBroadcast(errorIntent);
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static void putJson(JSONObject target, String key, Object value) {
        try {
            target.put(key, value);
        } catch (Exception ignored) {
        }
    }
}
