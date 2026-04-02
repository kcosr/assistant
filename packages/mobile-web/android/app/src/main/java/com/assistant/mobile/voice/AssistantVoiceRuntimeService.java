package com.assistant.mobile.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.core.content.ContextCompat;

import com.assistant.mobile.MainActivity;
import com.assistant.mobile.R;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
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
    static final String ACTION_TOGGLE_MEDIA_BUTTONS = "com.assistant.mobile.voice.TOGGLE_MEDIA_BUTTONS";
    static final String EXTRA_MANUAL_LISTEN_SESSION_ID = "manualListenSessionId";

    static final String BROADCAST_STATE_CHANGED = "com.assistant.mobile.voice.STATE_CHANGED";
    static final String BROADCAST_RUNTIME_ERROR = "com.assistant.mobile.voice.RUNTIME_ERROR";
    static final String EXTRA_STATE = "state";
    static final String EXTRA_MESSAGE = "message";

    static final String LEGACY_NOTIFICATION_CHANNEL_ID = "assistant_voice_mode";
    static final String NOTIFICATION_CHANNEL_ID = "assistant_voice_runtime_controls";
    static final int NOTIFICATION_CHANNEL_IMPORTANCE = NotificationManager.IMPORTANCE_DEFAULT;
    static final int NOTIFICATION_PRIORITY = NotificationCompat.PRIORITY_DEFAULT;
    static final int NOTIFICATION_VISIBILITY = NotificationCompat.VISIBILITY_PUBLIC;
    static final int NOTIFICATION_LOCKSCREEN_VISIBILITY = Notification.VISIBILITY_PUBLIC;
    static final String NOTIFICATION_CATEGORY = NotificationCompat.CATEGORY_SERVICE;
    private static final int NOTIFICATION_ID = 4302;
    private static final long ADAPTER_RECONNECT_DELAY_MS = 2000L;
    private static final int MAX_RECOGNITION_CUE_RETRIES = 2;
    private static final long RECOGNITION_CUE_RETRY_DELAY_MS = 90L;
    private static final long RECOGNITION_CUE_POST_ARMING_DELAY_MS = 120L;
    private static final long RECOGNITION_CUE_POST_STOP_DELAY_MS = 320L;
    private static final long MEDIA_SESSION_PLAYBACK_ACTIONS =
        PlaybackState.ACTION_PLAY
            | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_STOP;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final String RECOGNITION_ARMING_CUE_REQUEST_PREFIX = "__recognition_arming__:";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final OkHttpClient httpClient = new OkHttpClient.Builder()
        .readTimeout(30, TimeUnit.SECONDS)
        .build();
    private final OkHttpClient adapterSocketClient = new OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build();
    private AssistantVoicePcmPlayer player;
    private AssistantVoiceMicStreamer micStreamer;
    private MediaSession mediaSession;

    private final Runnable reconnectRunnable = this::connectAdapterSocketIfNeeded;
    private final Runnable assistantReconnectRunnable = this::connectAssistantSocketIfNeeded;

    private AssistantVoiceConfig config;
    private WebSocket adapterSocket;
    private WebSocket assistantSocket;
    private boolean adapterSocketConnected = false;
    private boolean assistantSocketConnected = false;
    private String adapterClientId = "";
    private final Set<String> assistantSubscribedSessionIds = new LinkedHashSet<>();
    private String runtimeState = STATE_DISABLED;

    // The session currently owning native playback/listen/submit. This is set
    // both for prompt-driven playback and for manual notification/foreground listen.
    private String activeVoiceSessionId = "";
    private String activePromptToolName = "";
    private String activeTtsRequestId = "";
    private String pendingPlaybackDrainRequestId = "";
    private boolean pendingPlaybackDrainStartsListening = false;
    private String activeSttRequestId = "";
    private String pendingRecognitionArmingCueRequestId = "";
    private String adapterStoppedSttRequestId = "";
    private String pendingRecognitionCompletionCueRequestId = "";
    private String stoppedRecognitionRequestId = "";
    private boolean pendingRecognitionCompletionCueSuccess = false;
    private boolean recognitionReadyCuePlayed = false;
    private boolean recognitionCompletionCuePlayed = false;
    private boolean watchedSessionRefreshInFlight = false;
    private boolean watchedSessionRefreshPending = false;
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

    public static Intent startManualListenIntent(Context context, String sessionId) {
        return new Intent(context, AssistantVoiceRuntimeService.class)
            .setAction(ACTION_START_MANUAL_LISTEN)
            .putExtra(EXTRA_MANUAL_LISTEN_SESSION_ID, trim(sessionId));
    }

    public static Intent toggleMediaButtonsIntent(Context context) {
        return new Intent(context, AssistantVoiceRuntimeService.class)
            .setAction(ACTION_TOGGLE_MEDIA_BUTTONS);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        micStreamer = new AssistantVoiceMicStreamer(this);
        player = new AssistantVoicePcmPlayer(this);
        config = AssistantVoiceConfig.load(this);
        micStreamer.setPreferredDeviceId(config.selectedMicDeviceId);
        player.setTtsGain(config.ttsGain);
        player.setRecognitionCueGain(config.recognitionCueGain);
        player.setStartupPreRollMs(config.startupPreRollMs);
        player.setListener(requestId -> mainHandler.post(() -> handlePlaybackDrained(requestId)));
        initializeMediaSession();
        createNotificationChannel();
        startInForeground();
        syncMediaSession();
        if (!config.isEnabled()) {
            updateState(STATE_DISABLED, null);
            stopSelf();
            return;
        }
        updateState(STATE_CONNECTING, null);
        connectAdapterSocketIfNeeded();
        refreshWatchedSessionsAsync();
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
            startManualListen(intent.getStringExtra(EXTRA_MANUAL_LISTEN_SESSION_ID));
            return START_STICKY;
        }
        if (ACTION_TOGGLE_MEDIA_BUTTONS.equals(action)) {
            applyConfig(config.withMediaButtonsEnabled(!config.mediaButtonsEnabled));
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
        releaseMediaSession();
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
        player.setTtsGain(updated.ttsGain);
        player.setRecognitionCueGain(updated.recognitionCueGain);
        player.setStartupPreRollMs(updated.startupPreRollMs);

        boolean preferredSessionChanged =
            !previous.preferredVoiceSessionId.equals(updated.preferredVoiceSessionId);
        boolean audioModeChanged = !previous.audioMode.equals(updated.audioMode);
        boolean adapterUrlChanged = !previous.voiceAdapterBaseUrl.equals(updated.voiceAdapterBaseUrl);
        boolean assistantUrlChanged = !previous.assistantBaseUrl.equals(updated.assistantBaseUrl);

        if (!updated.isEnabled()) {
            stopCurrentInteraction(false, "voice_mode_disabled");
            disconnectAdapterSocket();
            disconnectAssistantSocket();
            syncMediaSession();
            updateState(STATE_DISABLED, null);
            stopSelf();
            return;
        }

        startInForeground();
        syncMediaSession();

        if (adapterUrlChanged || assistantUrlChanged) {
            stopCurrentInteraction(false, "config_changed");
        }

        if (adapterUrlChanged) {
            disconnectAdapterSocket();
        }

        if (assistantUrlChanged) {
            disconnectAssistantSocket();
        } else if (audioModeChanged) {
            syncAssistantSessionSubscriptions(previous.watchedSessionIds, updated.watchedSessionIds, true);
        }

        if (!adapterSocketConnected) {
            updateState(STATE_CONNECTING, null);
            connectAdapterSocketIfNeeded();
        }

        if (!assistantSocketConnected) {
            updateState(STATE_CONNECTING, null);
            connectAssistantSocketIfNeeded();
            refreshWatchedSessionsAsync();
        } else if (preferredSessionChanged) {
            refreshNotification();
        } else if (!hasActiveInteraction()) {
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
        }
    }

    private void initializeMediaSession() {
        mediaSession = new MediaSession(this, TAG + ":media_buttons");
        mediaSession.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                Log.d(TAG, "MediaSession onPlay");
                mainHandler.post(() -> {
                    if (!config.mediaButtonsEnabled) {
                        Log.d(TAG, "MediaSession onPlay ignored: media buttons disabled");
                        return;
                    }
                    startManualListen("");
                });
            }

            @Override
            public void onPause() {
                Log.d(TAG, "MediaSession onPause");
                mainHandler.post(() -> handleMediaSessionStop());
            }

            @Override
            public void onStop() {
                Log.d(TAG, "MediaSession onStop");
                mainHandler.post(() -> handleMediaSessionStop());
            }

            @Override
            public boolean onMediaButtonEvent(Intent mediaButtonIntent) {
                Log.d(TAG, "MediaSession onMediaButtonEvent intent=" + mediaButtonIntent);
                if (!config.mediaButtonsEnabled) {
                    Log.d(TAG, "MediaSession media button ignored: media buttons disabled");
                    return false;
                }
                KeyEvent event =
                    mediaButtonIntent == null
                        ? null
                        : mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                Log.d(TAG, "MediaSession media button event=" + describeKeyEvent(event));
                if (!shouldHandleMediaButtonKeyEvent(event)) {
                    Log.d(TAG, "MediaSession media button ignored: unsupported event");
                    return false;
                }
                mainHandler.post(() -> handleMediaButtonKeyCode(event.getKeyCode()));
                return true;
            }
        });
    }

    private void handleMediaButtonKeyCode(int keyCode) {
        Log.d(
            TAG,
            "handleMediaButtonKeyCode keyCode="
                + KeyEvent.keyCodeToString(keyCode)
                + " runtimeState="
                + runtimeState
                + " hasActiveInteraction="
                + hasActiveInteraction()
        );
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                startManualListen("");
                return;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                handleMediaSessionStop();
                return;
            case KeyEvent.KEYCODE_HEADSETHOOK:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (shouldStopForMediaButtonToggle(runtimeState, hasActiveInteraction())) {
                    handleMediaSessionStop();
                } else {
                    startManualListen("");
                }
                return;
            default:
                return;
        }
    }

    private void handleMediaSessionStop() {
        if (!config.mediaButtonsEnabled) {
            Log.d(TAG, "handleMediaSessionStop ignored: media buttons disabled");
            return;
        }
        Log.d(
            TAG,
            "handleMediaSessionStop runtimeState="
                + runtimeState
                + " promptPlaybackActive="
                + isPromptPlaybackActive()
                + " activeSttRequestId="
                + !activeSttRequestId.isEmpty()
        );
        stopCurrentInteraction(isPromptPlaybackActive(), "manual_stop");
    }

    static boolean shouldHandleMediaButtonKeyEvent(KeyEvent event) {
        return event != null
            && event.getAction() == KeyEvent.ACTION_DOWN
            && event.getRepeatCount() == 0;
    }

    static boolean shouldStopForMediaButtonToggle(String state, boolean hasActiveInteraction) {
        return hasActiveInteraction
            || STATE_LISTENING.equals(trim(state))
            || STATE_SPEAKING.equals(trim(state));
    }

    private static String describeKeyEvent(KeyEvent event) {
        if (event == null) {
            return "null";
        }
        return "action="
            + event.getAction()
            + ",keyCode="
            + KeyEvent.keyCodeToString(event.getKeyCode())
            + ",repeat="
            + event.getRepeatCount();
    }

    private void syncMediaSession() {
        if (mediaSession == null) {
            return;
        }
        boolean enabled = config.isEnabled() && config.mediaButtonsEnabled && !destroyed;
        int mediaPlaybackState = resolveMediaSessionPlaybackState(runtimeState);
        PlaybackState.Builder playbackState = new PlaybackState.Builder()
            .setActions(enabled ? MEDIA_SESSION_PLAYBACK_ACTIONS : 0L)
            .setState(
                mediaPlaybackState,
                PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                STATE_SPEAKING.equals(runtimeState) || STATE_LISTENING.equals(runtimeState) ? 1.0f : 0.0f
            );
        mediaSession.setPlaybackState(playbackState.build());
        mediaSession.setActive(enabled);
        Log.d(
            TAG,
            "syncMediaSession enabled="
                + enabled
                + " runtimeState="
                + runtimeState
                + " playbackState="
                + mediaPlaybackState
                + " hasActiveInteraction="
                + hasActiveInteraction()
        );
    }

    private void releaseMediaSession() {
        if (mediaSession == null) {
            return;
        }
        try {
            mediaSession.setActive(false);
            mediaSession.release();
        } catch (Exception ignored) {
        }
        mediaSession = null;
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
        PendingIntent startListenPendingIntent = PendingIntent.getService(
            this,
            1,
            startManualListenIntent(this, null),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        PendingIntent stopInteractionPendingIntent = PendingIntent.getService(
            this,
            2,
            stopCurrentInteractionIntent(this),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        PendingIntent toggleMediaButtonsPendingIntent = PendingIntent.getService(
            this,
            3,
            toggleMediaButtonsIntent(this),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        boolean showSpeakAction = AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            config.isEnabled(),
            config.preferredVoiceSessionId,
            isPromptPlaybackActive(),
            !activeSttRequestId.isEmpty(),
            isRuntimeConnected()
        );
        boolean showStopAction = AssistantVoiceInteractionRules.shouldShowNotificationStopAction(
            isPromptPlaybackActive(),
            !activeSttRequestId.isEmpty()
        );
        String notificationSessionTitle = resolveNotificationSessionTitle();

        return buildNotification(
            this,
            state,
            notificationSessionTitle,
            launchPendingIntent,
            startListenPendingIntent,
            stopInteractionPendingIntent,
            toggleMediaButtonsPendingIntent,
            showSpeakAction,
            showStopAction,
            config.mediaButtonsEnabled
        );
    }

    static Notification buildNotification(
        Context context,
        String state,
        String sessionTitle,
        PendingIntent launchPendingIntent,
        PendingIntent startListenPendingIntent,
        PendingIntent stopInteractionPendingIntent,
        PendingIntent toggleMediaButtonsPendingIntent,
        boolean showSpeakAction,
        boolean showStopAction,
        boolean mediaButtonsEnabled
    ) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(
                context.getString(
                    R.string.assistant_voice_notification_title,
                    formatNotificationStateLabel(context, state)
                )
            )
            .setContentIntent(launchPendingIntent)
            .setPriority(NOTIFICATION_PRIORITY)
            .setVisibility(NOTIFICATION_VISIBILITY)
            .setCategory(NOTIFICATION_CATEGORY)
            .setOngoing(true);
        String normalizedSessionTitle = trim(sessionTitle);
        if (!normalizedSessionTitle.isEmpty()) {
            builder.setContentText(normalizedSessionTitle);
        }
        int compactActionCount = 0;
        if (showSpeakAction) {
            builder.addAction(
                android.R.drawable.ic_btn_speak_now,
                context.getString(R.string.assistant_voice_notification_action_speak),
                startListenPendingIntent
            );
            compactActionCount += 1;
        }
        if (showStopAction) {
            builder.addAction(
                android.R.drawable.ic_media_pause,
                context.getString(R.string.assistant_voice_notification_action_stop),
                stopInteractionPendingIntent
            );
            compactActionCount += 1;
        }
        builder.addAction(
            resolveNotificationMediaButtonsActionIcon(mediaButtonsEnabled),
            "",
            toggleMediaButtonsPendingIntent
        );
        if (compactActionCount > 0) {
            if (compactActionCount == 1) {
                builder.setStyle(new MediaStyle().setShowActionsInCompactView(0));
            } else {
                builder.setStyle(new MediaStyle().setShowActionsInCompactView(0, 1));
            }
        }
        return builder.build();
    }

    static int resolveNotificationMediaButtonsActionIcon(boolean mediaButtonsEnabled) {
        return mediaButtonsEnabled
            ? R.drawable.ic_notification_media_buttons_enabled
            : R.drawable.ic_notification_media_buttons_disabled;
    }

    private void createNotificationChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        ensureNotificationChannel(this, manager);
    }

    static void ensureNotificationChannel(Context context, NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || manager == null) {
            return;
        }
        boolean migratedLegacyChannel = false;
        // Channel importance and lock-screen visibility are sticky after first creation.
        if (!LEGACY_NOTIFICATION_CHANNEL_ID.equals(NOTIFICATION_CHANNEL_ID)
            && manager.getNotificationChannel(LEGACY_NOTIFICATION_CHANNEL_ID) != null) {
            manager.deleteNotificationChannel(LEGACY_NOTIFICATION_CHANNEL_ID);
            migratedLegacyChannel = true;
        }
        NotificationChannel existingChannel = manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID);
        if (!migratedLegacyChannel && notificationChannelMatches(existingChannel, context)) {
            return;
        }
        manager.createNotificationChannel(buildNotificationChannel(context));
    }

    static NotificationChannel buildNotificationChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            context.getString(R.string.assistant_voice_notification_channel_name),
            NOTIFICATION_CHANNEL_IMPORTANCE
        );
        channel.setDescription(context.getString(R.string.assistant_voice_notification_channel_description));
        channel.setLockscreenVisibility(NOTIFICATION_LOCKSCREEN_VISIBILITY);
        return channel;
    }

    private String resolveNotificationSessionTitle() {
        if (hasActiveInteraction()) {
            return config.getSessionTitle(activeVoiceSessionId);
        }
        String preferredTitle = config.getSessionTitle(config.preferredVoiceSessionId);
        if (!preferredTitle.isEmpty()) {
            return preferredTitle;
        }
        return config.getSessionTitle(config.selectedSessionId);
    }

    static String formatNotificationStateLabel(Context context, String state) {
        switch (trim(state)) {
            case STATE_CONNECTING:
                return context.getString(R.string.assistant_voice_notification_state_connecting);
            case STATE_IDLE:
                return context.getString(R.string.assistant_voice_notification_state_idle);
            case STATE_SPEAKING:
                return context.getString(R.string.assistant_voice_notification_state_speaking);
            case STATE_LISTENING:
                return context.getString(R.string.assistant_voice_notification_state_listening);
            case STATE_ERROR:
                return context.getString(R.string.assistant_voice_notification_state_error);
            case STATE_DISABLED:
            default:
                return context.getString(R.string.assistant_voice_notification_state_disabled);
        }
    }

    static int resolveMediaSessionPlaybackState(String state) {
        switch (trim(state)) {
            case STATE_LISTENING:
            case STATE_SPEAKING:
                return PlaybackState.STATE_PLAYING;
            case STATE_DISABLED:
                return PlaybackState.STATE_STOPPED;
            case STATE_ERROR:
                return PlaybackState.STATE_ERROR;
            case STATE_CONNECTING:
            case STATE_IDLE:
            default:
                return PlaybackState.STATE_PAUSED;
        }
    }

    private static boolean notificationChannelMatches(
        NotificationChannel channel,
        Context context
    ) {
        if (channel == null) {
            return false;
        }
        CharSequence expectedName = context.getString(R.string.assistant_voice_notification_channel_name);
        String expectedDescription =
            context.getString(R.string.assistant_voice_notification_channel_description);
        return channel.getImportance() == NOTIFICATION_CHANNEL_IMPORTANCE
            && channel.getLockscreenVisibility() == NOTIFICATION_LOCKSCREEN_VISIBILITY
            && expectedName.toString().contentEquals(channel.getName())
            && expectedDescription.equals(channel.getDescription());
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
                    assistantSubscribedSessionIds.clear();
                    webSocket.send(
                        AssistantVoiceSessionSocketProtocol.buildHelloMessage(
                            config.watchedSessionIds,
                            config.audioMode
                        )
                    );
                    refreshWatchedSessionsAsync();
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
        assistantSubscribedSessionIds.clear();
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
        assistantSubscribedSessionIds.clear();
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
            assistantSubscribedSessionIds.add(subscribedSessionId);
            if (!hasActiveInteraction() && isRuntimeConnected()) {
                updateState(STATE_IDLE, null);
            }
            return;
        }

        String unsubscribedSessionId =
            AssistantVoiceSessionSocketProtocol.parseSubscriptionSessionId(rawText, "unsubscribed");
        if (!unsubscribedSessionId.isEmpty()) {
            assistantSubscribedSessionIds.remove(unsubscribedSessionId);
            return;
        }

        String messageType = "";
        try {
            messageType = trim(new JSONObject(rawText).optString("type"));
        } catch (Exception ignored) {
        }
        // These lifecycle messages are global broadcasts from the assistant
        // server, so they still arrive even when per-session subscriptions are masked.
        if ("session_created".equals(messageType) || "session_deleted".equals(messageType)) {
            refreshWatchedSessionsAsync();
        }

        AssistantVoicePromptEvent prompt =
            AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(rawText);
        if (prompt == null) {
            return;
        }
        if (!isWatchedSessionId(prompt.sessionId)) {
            return;
        }
        if (
            AssistantVoiceInteractionRules.shouldAutoplayEvent(
                config.audioMode,
                prompt,
                !hasActiveInteraction()
            )
        ) {
            beginPromptPlayback(prompt);
        }
    }

    private void syncAssistantSessionSubscriptions(
        List<String> previousSessionIds,
        List<String> nextSessionIds,
        boolean replaceExistingMasks
    ) {
        if (!assistantSocketConnected || assistantSocket == null) {
            assistantSubscribedSessionIds.clear();
            return;
        }

        LinkedHashSet<String> previous = normalizeSessionIdSet(previousSessionIds);
        LinkedHashSet<String> next = normalizeSessionIdSet(nextSessionIds);

        for (String sessionId : previous) {
            if (next.contains(sessionId)) {
                continue;
            }
            assistantSocket.send(AssistantVoiceSessionSocketProtocol.buildUnsubscribeMessage(sessionId));
            assistantSubscribedSessionIds.remove(sessionId);
        }

        for (String sessionId : next) {
            if (!replaceExistingMasks && previous.contains(sessionId) && assistantSubscribedSessionIds.contains(sessionId)) {
                continue;
            }
            assistantSocket.send(
                AssistantVoiceSessionSocketProtocol.buildSubscribeMessage(sessionId, config.audioMode)
            );
        }
    }

    private void refreshWatchedSessionsAsync() {
        mainHandler.post(() -> scheduleWatchedSessionsRefresh());
    }

    private void scheduleWatchedSessionsRefresh() {
        if (!config.isEnabled() || destroyed) {
            return;
        }
        if (watchedSessionRefreshInFlight) {
            watchedSessionRefreshPending = true;
            return;
        }
        watchedSessionRefreshInFlight = true;
        networkExecutor.execute(() -> {
            List<String> sessionIds = fetchWatchedSessionIds();
            mainHandler.post(() -> {
                try {
                    applyWatchedSessionIds(sessionIds);
                } finally {
                    finishWatchedSessionsRefresh();
                }
            });
        });
    }

    private void finishWatchedSessionsRefresh() {
        watchedSessionRefreshInFlight = false;
        if (!watchedSessionRefreshPending) {
            return;
        }
        watchedSessionRefreshPending = false;
        scheduleWatchedSessionsRefresh();
    }

    private List<String> fetchWatchedSessionIds() {
        try {
            JSONObject body = new JSONObject();
            String response = postJson(
                AssistantVoiceUrlUtils.assistantSessionListUrl(config.assistantBaseUrl),
                body
            );
            return parseWatchedSessionIds(response);
        } catch (Exception error) {
            Log.w(TAG, "Failed to refresh watched sessions", error);
            return config.watchedSessionIds;
        }
    }

    private List<String> parseWatchedSessionIds(String rawJson) {
        LinkedHashSet<String> sessionIds = new LinkedHashSet<>();
        try {
            JSONObject payload = new JSONObject(rawJson);
            JSONObject result =
                payload.has("result") && payload.optJSONObject("result") != null
                    ? payload.optJSONObject("result")
                    : payload;
            if (result == null) {
                return new ArrayList<>(sessionIds);
            }
            org.json.JSONArray sessions = result.optJSONArray("sessions");
            if (sessions == null) {
                return new ArrayList<>(sessionIds);
            }
            for (int index = 0; index < sessions.length(); index += 1) {
                JSONObject session = sessions.optJSONObject(index);
                if (session == null) {
                    continue;
                }
                String sessionId = trim(session.optString("sessionId"));
                if (!sessionId.isEmpty()) {
                    sessionIds.add(sessionId);
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "Failed to parse watched session ids", error);
            return config.watchedSessionIds;
        }
        return new ArrayList<>(sessionIds);
    }

    private void applyWatchedSessionIds(List<String> sessionIds) {
        if (destroyed) {
            return;
        }
        LinkedHashSet<String> nextSessionIds = normalizeSessionIdSet(sessionIds);
        LinkedHashSet<String> previousSessionIds = normalizeSessionIdSet(config.watchedSessionIds);
        if (
            config.preferredVoiceSessionId.isEmpty()
            || nextSessionIds.contains(config.preferredVoiceSessionId)
        ) {
            if (previousSessionIds.equals(nextSessionIds)) {
                return;
            }
            config = config.withWatchedSessionIds(new ArrayList<>(nextSessionIds));
            AssistantVoiceConfig.save(this, config);
            syncAssistantSessionSubscriptions(
                new ArrayList<>(previousSessionIds),
                config.watchedSessionIds,
                false
            );
            return;
        }

        AssistantVoiceConfig updated = config
            .withWatchedSessionIds(new ArrayList<>(nextSessionIds))
            .withPreferredVoiceSessionId("");
        List<String> previous = config.watchedSessionIds;
        config = updated;
        AssistantVoiceConfig.save(this, updated);
        syncAssistantSessionSubscriptions(previous, updated.watchedSessionIds, false);
        refreshNotification();
    }

    private LinkedHashSet<String> normalizeSessionIdSet(List<String> sessionIds) {
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        if (sessionIds == null) {
            return normalized;
        }
        for (String sessionId : sessionIds) {
            String trimmed = trim(sessionId);
            if (!trimmed.isEmpty()) {
                normalized.add(trimmed);
            }
        }
        return normalized;
    }

    private boolean isWatchedSessionId(String sessionId) {
        String expected = trim(sessionId);
        if (expected.isEmpty()) {
            return false;
        }
        for (String watchedSessionId : config.watchedSessionIds) {
            if (expected.equals(trim(watchedSessionId))) {
                return true;
            }
        }
        return false;
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
        String recognitionRequestId = extractRecognitionArmingCueRequestId(requestId);
        if (!recognitionRequestId.isEmpty()) {
            if (!shouldStartRecognitionAfterArmingCue(
                pendingRecognitionArmingCueRequestId,
                requestId
            )) {
                return;
            }
            mainHandler.postDelayed(
                () -> {
                    if (!recognitionRequestId.equals(pendingRecognitionArmingCueRequestId)) {
                        return;
                    }
                    startRecognitionCapture(recognitionRequestId);
                },
                RECOGNITION_CUE_POST_ARMING_DELAY_MS
            );
            return;
        }
        if (!requestId.equals(pendingPlaybackDrainRequestId)) {
            return;
        }
        boolean shouldStartListening = pendingPlaybackDrainStartsListening;
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        if (shouldStartListening) {
            startRecognition(activeVoiceSessionId, "playback_completion");
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

        String sessionId = activeVoiceSessionId;
        boolean success = message.optBoolean("success", false);
        boolean canceled = message.optBoolean("canceled", false);
        String text = trim(message.optString("text"));
        String error = trim(message.optString("error"));
        int durationMs = Math.max(0, message.optInt("durationMs", 0));
        boolean positiveCue = shouldUsePositiveRecognitionCue(success, text);
        boolean captureAlreadyStopped =
            shouldScheduleQueuedRecognitionCompletionCueAfterResult(
                stoppedRecognitionRequestId,
                requestId
            );

        activeSttRequestId = "";
        queueRecognitionCompletionCue(requestId, positiveCue);
        if (captureAlreadyStopped) {
            stoppedRecognitionRequestId = "";
            scheduleQueuedRecognitionCompletionCueIfNeeded(requestId);
        } else if (micStreamer != null) {
            adapterStoppedSttRequestId = requestId;
            micStreamer.stop(requestId);
        }

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

        if (positiveCue && !sessionId.isEmpty()) {
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
        if (!adapterSocketConnected || adapterClientId.isEmpty()) {
            return;
        }

        String requestId = UUID.randomUUID().toString();
        activeVoiceSessionId = prompt.sessionId;
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
        String speakingSessionId = activeVoiceSessionId;
        String speakingToolName = activePromptToolName;
        boolean playManualStopCue =
            "manual_stop".equals(reason) && !listeningRequestId.isEmpty();
        boolean pendingArmingCue =
            listeningRequestId.equals(pendingRecognitionArmingCueRequestId);

        activeTtsRequestId = "";
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        pendingRecognitionArmingCueRequestId = "";
        player.stop();

        if (!ttsRequestId.isEmpty()) {
            requestAdapterTtsStop(ttsRequestId);
        }

        if (!listeningRequestId.isEmpty()) {
            activeSttRequestId = "";
            if (playManualStopCue) {
                if (pendingArmingCue) {
                    playRecognitionCompletionCueIfNeeded(false);
                } else {
                    queueRecognitionCompletionCue(listeningRequestId, false);
                }
            }
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

    private void startManualListen(String requestedSessionId) {
        String targetSessionId = trim(requestedSessionId);
        if (targetSessionId.isEmpty()) {
            targetSessionId = config.preferredVoiceSessionId;
        }
        if (!config.isEnabled() || targetSessionId.isEmpty()) {
            return;
        }
        if (isPromptPlaybackActive()) {
            stopCurrentInteraction(true, "manual_listen");
            return;
        }
        if (!activeSttRequestId.isEmpty()) {
            return;
        }
        startRecognition(targetSessionId, "manual_listen");
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
        activeVoiceSessionId = sessionId.trim();
        activePromptToolName = "manual_listen".equals(reason) ? "voice_manual" : activePromptToolName;
        activeSttRequestId = requestId;
        resetRecognitionCueState();
        Log.d(TAG, "startRecognition requestId=" + requestId + " sessionId=" + activeVoiceSessionId + " reason=" + reason);

        if (micStreamer == null) {
            activeSttRequestId = "";
            playRecognitionCompletionCueIfNeeded(false);
            resetRecognitionCueState();
            clearActivePromptContext();
            updateState(isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING, null);
            emitRuntimeError("Microphone capture is unavailable");
            return;
        }

        pendingRecognitionArmingCueRequestId = requestId;
        boolean playedArmingCue = playRecognitionReadyCueIfNeeded();
        if (playedArmingCue) {
            return;
        }
        pendingRecognitionArmingCueRequestId = "";
        startRecognitionCapture(requestId);
    }

    private void startRecognitionCapture(String requestId) {
        if (!requestId.equals(activeSttRequestId) || micStreamer == null) {
            return;
        }

        pendingRecognitionArmingCueRequestId = "";
        player.beginRecognitionCaptureFocus();
        boolean started = micStreamer.start(requestId, new AssistantVoiceMicStreamer.Listener() {
            @Override
            public void onStarted(int sampleRate, int channels, String encoding) {
                mainHandler.post(() -> handleMicCaptureStarted(
                    requestId,
                    sampleRate,
                    channels,
                    encoding
                ));
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
            player.endRecognitionCaptureFocus();
            activeSttRequestId = "";
            playRecognitionCompletionCueIfNeeded(false);
            resetRecognitionCueState();
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

    private void handleMicCaptureStarted(
        String requestId,
        int sampleRate,
        int channels,
        String encoding
    ) {
        if (!requestId.equals(activeSttRequestId)) {
            return;
        }
        updateState(STATE_LISTENING, null);

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

    private void handleMicCaptureStopped(String requestId) {
        stoppedRecognitionRequestId = trim(requestId);
        player.endRecognitionCaptureFocus();
        if (scheduleQueuedRecognitionCompletionCueIfNeeded(requestId)) {
            stoppedRecognitionRequestId = "";
        }
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
                String content = text;
                if (config.inputContextEnabled && !config.inputContextLine.isEmpty()) {
                    content = config.inputContextLine + "\n" + text;
                }
                JSONObject body = new JSONObject();
                body.put("sessionId", sessionId);
                body.put("content", content);
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
        activeVoiceSessionId = "";
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

    private void refreshNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(runtimeState));
        }
        syncMediaSession();
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
        refreshNotification();
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

    static boolean shouldUsePositiveRecognitionCue(boolean success, String text) {
        return success && !trim(text).isEmpty();
    }

    static boolean shouldPlayQueuedRecognitionCompletionCue(
        String pendingRequestId,
        String stoppedRequestId
    ) {
        String expected = trim(pendingRequestId);
        return !expected.isEmpty() && expected.equals(trim(stoppedRequestId));
    }

    static boolean shouldScheduleQueuedRecognitionCompletionCueAfterResult(
        String stoppedRequestId,
        String resultRequestId
    ) {
        String stopped = trim(stoppedRequestId);
        return !stopped.isEmpty() && stopped.equals(trim(resultRequestId));
    }

    private void resetRecognitionCueState() {
        pendingRecognitionCompletionCueRequestId = "";
        pendingRecognitionCompletionCueSuccess = false;
        pendingRecognitionArmingCueRequestId = "";
        stoppedRecognitionRequestId = "";
        recognitionReadyCuePlayed = false;
        recognitionCompletionCuePlayed = false;
    }

    private void queueRecognitionCompletionCue(String requestId, boolean success) {
        pendingRecognitionCompletionCueRequestId = trim(requestId);
        pendingRecognitionCompletionCueSuccess = success;
    }

    private void playQueuedRecognitionCompletionCueIfNeeded(String requestId) {
        if (!shouldPlayQueuedRecognitionCompletionCue(pendingRecognitionCompletionCueRequestId, requestId)) {
            return;
        }
        boolean success = pendingRecognitionCompletionCueSuccess;
        pendingRecognitionCompletionCueRequestId = "";
        pendingRecognitionCompletionCueSuccess = false;
        playRecognitionCompletionCueIfNeeded(success);
    }

    private boolean scheduleQueuedRecognitionCompletionCueIfNeeded(String requestId) {
        if (!shouldPlayQueuedRecognitionCompletionCue(pendingRecognitionCompletionCueRequestId, requestId)) {
            return false;
        }
        boolean success = pendingRecognitionCompletionCueSuccess;
        pendingRecognitionCompletionCueRequestId = "";
        pendingRecognitionCompletionCueSuccess = false;
        mainHandler.postDelayed(
            () -> playRecognitionCompletionCueIfNeeded(success),
            RECOGNITION_CUE_POST_STOP_DELAY_MS
        );
        return true;
    }

    private boolean playRecognitionReadyCueIfNeeded() {
        if (!config.recognitionCueEnabled || recognitionReadyCuePlayed) {
            return false;
        }
        recognitionReadyCuePlayed = true;
        return playRecognitionCueWithRetry(
            buildRecognitionArmingCueRequestId(activeSttRequestId),
            AssistantVoicePcmPlayer.RecognitionCueType.ARMING,
            0
        );
    }

    private void playRecognitionCompletionCueIfNeeded(boolean success) {
        if (!config.recognitionCueEnabled || recognitionCompletionCuePlayed) {
            return;
        }
        recognitionCompletionCuePlayed = true;
        playRecognitionCueWithRetry(
            "",
            success
                ? AssistantVoicePcmPlayer.RecognitionCueType.SUCCESS_COMPLETION
                : AssistantVoicePcmPlayer.RecognitionCueType.FAILURE_COMPLETION,
            0
        );
    }

    private boolean playRecognitionCueWithRetry(
        String requestId,
        AssistantVoicePcmPlayer.RecognitionCueType cueType,
        int attempt
    ) {
        if (!config.recognitionCueEnabled) {
            return false;
        }
        if (player.playRecognitionCue(requestId, cueType)) {
            return true;
        }
        if (attempt >= MAX_RECOGNITION_CUE_RETRIES) {
            return false;
        }
        mainHandler.postDelayed(
            () -> playRecognitionCueWithRetry(requestId, cueType, attempt + 1),
            RECOGNITION_CUE_RETRY_DELAY_MS * (attempt + 1L)
        );
        return false;
    }

    static String buildRecognitionArmingCueRequestId(String requestId) {
        String normalized = trim(requestId);
        return normalized.isEmpty() ? "" : RECOGNITION_ARMING_CUE_REQUEST_PREFIX + normalized;
    }

    static String extractRecognitionArmingCueRequestId(String playbackRequestId) {
        String normalized = trim(playbackRequestId);
        if (!normalized.startsWith(RECOGNITION_ARMING_CUE_REQUEST_PREFIX)) {
            return "";
        }
        return trim(normalized.substring(RECOGNITION_ARMING_CUE_REQUEST_PREFIX.length()));
    }

    static boolean shouldStartRecognitionAfterArmingCue(
        String pendingRecognitionRequestId,
        String playbackRequestId
    ) {
        return trim(pendingRecognitionRequestId).equals(
            extractRecognitionArmingCueRequestId(playbackRequestId)
        );
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
