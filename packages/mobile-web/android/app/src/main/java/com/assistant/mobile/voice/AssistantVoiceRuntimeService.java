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
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import com.assistant.mobile.MainActivity;
import com.assistant.mobile.R;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
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
    static final String ACTION_RETARGET_ACTIVE_RECOGNITION =
        "com.assistant.mobile.voice.RETARGET_ACTIVE_RECOGNITION";
    static final String ACTION_TOGGLE_MEDIA_BUTTONS = "com.assistant.mobile.voice.TOGGLE_MEDIA_BUTTONS";
    static final String ACTION_CYCLE_AUDIO_MODE = "com.assistant.mobile.voice.CYCLE_AUDIO_MODE";
    static final String ACTION_NOTIFICATION_SPEAKER = "com.assistant.mobile.voice.NOTIFICATION_SPEAKER";
    static final String ACTION_NOTIFICATION_MIC = "com.assistant.mobile.voice.NOTIFICATION_MIC";
    static final String ACTION_NOTIFICATION_DISMISS = "com.assistant.mobile.voice.NOTIFICATION_DISMISS";
    static final String EXTRA_MANUAL_LISTEN_SESSION_ID = "manualListenSessionId";
    static final String EXTRA_NOTIFICATION_ID = "notificationId";
    static final String EXTRA_NOTIFICATION_KIND = "notificationKind";
    static final String EXTRA_NOTIFICATION_SOURCE = "notificationSource";
    static final String EXTRA_NOTIFICATION_TITLE = "notificationTitle";
    static final String EXTRA_NOTIFICATION_BODY = "notificationBody";
    static final String EXTRA_NOTIFICATION_SESSION_ID = "notificationSessionId";
    static final String EXTRA_NOTIFICATION_SESSION_TITLE = "notificationSessionTitle";
    static final String EXTRA_NOTIFICATION_VOICE_MODE = "notificationVoiceMode";
    static final String EXTRA_NOTIFICATION_TTS_TEXT = "notificationTtsText";
    static final String EXTRA_NOTIFICATION_SOURCE_EVENT_ID = "notificationSourceEventId";
    static final String EXTRA_NOTIFICATION_SESSION_ACTIVITY_SEQ = "notificationSessionActivitySeq";

    static final String BROADCAST_STATE_CHANGED = "com.assistant.mobile.voice.STATE_CHANGED";
    static final String BROADCAST_RUNTIME_ERROR = "com.assistant.mobile.voice.RUNTIME_ERROR";
    static final String BROADCAST_OPEN_SESSION = "com.assistant.mobile.voice.OPEN_SESSION";
    static final String EXTRA_STATE = "state";
    static final String EXTRA_MESSAGE = "message";
    static final String EXTRA_OPEN_SESSION_ID = "openSessionId";

    static final String LEGACY_NOTIFICATION_CHANNEL_ID = "assistant_voice_mode";
    static final String NOTIFICATION_CHANNEL_ID = "assistant_voice_runtime_controls";
    static final String DURABLE_NOTIFICATION_CHANNEL_ID = "assistant_session_notifications";
    static final int NOTIFICATION_CHANNEL_IMPORTANCE = NotificationManager.IMPORTANCE_DEFAULT;
    static final int DURABLE_NOTIFICATION_CHANNEL_IMPORTANCE = NotificationManager.IMPORTANCE_DEFAULT;
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
    private static final long RECOGNITION_FAILURE_RETRY_FALLBACK_DELAY_MS = 1400L;
    private static final long RECOGNITION_SUBMIT_TIMEOUT_MS = 15000L;
    private static final long PLAYBACK_DRAIN_TIMEOUT_MS = 2500L;
    private static final long PLAYBACK_DRAIN_TIMEOUT_MARGIN_MS = 1200L;
    private static final int MAX_PENDING_QUEUE_ITEMS = 25;
    private static final int DURABLE_NOTIFICATION_ID_OFFSET = 24000;
    private static final long MEDIA_SESSION_PLAYBACK_ACTIONS =
        PlaybackState.ACTION_PLAY
            | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_STOP;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final String RECOGNITION_ARMING_CUE_REQUEST_PREFIX = "__recognition_arming__:";
    private static final String RECOGNITION_COMPLETION_CUE_REQUEST_PREFIX =
        "__recognition_completion__:";
    private static final String RECOGNITION_FAILURE_RETRY_CUE_REQUEST_PREFIX =
        "__recognition_failure_retry__:";

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
    private AssistantVoiceQueueItem activeQueueItem = null;
    private final List<AssistantVoiceQueueItem> queuedVoiceItems = new ArrayList<>();
    private final Map<String, AssistantVoiceNotificationRecord> durableNotifications =
        new LinkedHashMap<>();
    private String activeTtsRequestId = "";
    private String pendingPlaybackDrainRequestId = "";
    private boolean pendingPlaybackDrainStartsListening = false;
    private String pendingPlaybackDrainTimeoutRequestId = "";
    private int activeTtsTextLength = 0;
    private int activeTtsAudioChunkCount = 0;
    private int activeTtsAudioBytes = 0;
    private int activeTtsSampleRate = 0;
    private String pendingManualPreemptStopRequestId = "";
    private AssistantVoiceQueueItem pendingManualPreemptQueueItem = null;
    private String activeSttRequestId = "";
    private String pendingRecognitionArmingCueRequestId = "";
    private String adapterStoppedSttRequestId = "";
    private String pendingRecognitionCompletionCueRequestId = "";
    private String pendingRecognitionCompletionCuePlaybackRequestId = "";
    private String pendingRecognitionCompletionPlaybackRequestId = "";
    private String pendingRecognitionFailureRetrySessionId = "";
    private String pendingRecognitionSubmitSessionId = "";
    private String stoppedRecognitionRequestId = "";
    private boolean pendingRecognitionCompletionCueSuccess = false;
    private boolean recognitionReadyCuePlayed = false;
    private boolean recognitionCompletionCuePlayed = false;
    private boolean watchedSessionRefreshInFlight = false;
    private boolean watchedSessionRefreshPending = false;
    private boolean destroyed = false;
    private final Runnable clearPendingRecognitionSubmitRunnable = () ->
        clearPendingRecognitionSubmit("timeout", true);
    private final Runnable playbackDrainTimeoutRunnable = this::handlePlaybackDrainTimeout;

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

    public static Intent retargetActiveRecognitionIntent(Context context, String sessionId) {
        return new Intent(context, AssistantVoiceRuntimeService.class)
            .setAction(ACTION_RETARGET_ACTIVE_RECOGNITION)
            .putExtra(EXTRA_MANUAL_LISTEN_SESSION_ID, trim(sessionId));
    }

    public static Intent toggleMediaButtonsIntent(Context context) {
        return new Intent(context, AssistantVoiceRuntimeService.class)
            .setAction(ACTION_TOGGLE_MEDIA_BUTTONS);
    }

    public static Intent cycleAudioModeIntent(Context context) {
        return new Intent(context, AssistantVoiceRuntimeService.class)
            .setAction(ACTION_CYCLE_AUDIO_MODE);
    }

    static Intent cycleAudioModeIntent(Context context, String audioMode) {
        return cycleAudioModeIntent(context)
            .putExtra(AssistantVoiceConfig.EXTRA_AUDIO_MODE, trim(audioMode));
    }

    static Intent notificationSpeakerIntent(
        Context context,
        AssistantVoiceNotificationRecord notification
    ) {
        return buildNotificationActionIntent(context, ACTION_NOTIFICATION_SPEAKER, notification);
    }

    static Intent notificationMicIntent(Context context, AssistantVoiceNotificationRecord notification) {
        return buildNotificationActionIntent(context, ACTION_NOTIFICATION_MIC, notification);
    }

    static Intent notificationDismissIntent(
        Context context,
        AssistantVoiceNotificationRecord notification
    ) {
        return buildNotificationActionIntent(context, ACTION_NOTIFICATION_DISMISS, notification);
    }

    private static Intent buildNotificationActionIntent(
        Context context,
        String action,
        AssistantVoiceNotificationRecord notification
    ) {
        Intent intent = new Intent(context, AssistantVoiceRuntimeService.class);
        intent.setAction(action);
        intent.putExtra(EXTRA_NOTIFICATION_ID, notification.id);
        intent.putExtra(EXTRA_NOTIFICATION_KIND, notification.kind);
        intent.putExtra(EXTRA_NOTIFICATION_SOURCE, notification.source);
        intent.putExtra(EXTRA_NOTIFICATION_TITLE, notification.title);
        intent.putExtra(EXTRA_NOTIFICATION_BODY, notification.body);
        intent.putExtra(EXTRA_NOTIFICATION_SESSION_ID, notification.sessionId);
        intent.putExtra(EXTRA_NOTIFICATION_SESSION_TITLE, notification.sessionTitle);
        intent.putExtra(EXTRA_NOTIFICATION_VOICE_MODE, notification.voiceMode);
        intent.putExtra(EXTRA_NOTIFICATION_TTS_TEXT, notification.ttsText);
        intent.putExtra(EXTRA_NOTIFICATION_SOURCE_EVENT_ID, notification.sourceEventId);
        if (notification.sessionActivitySeq != null) {
            intent.putExtra(EXTRA_NOTIFICATION_SESSION_ACTIVITY_SEQ, notification.sessionActivitySeq);
        }
        return intent;
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
            recordVoiceEvent("service_action_stop_current_interaction", null);
            stopCurrentInteraction(isPromptPlaybackActive(), "manual_stop");
            return START_STICKY;
        }
        if (ACTION_START_MANUAL_LISTEN.equals(action)) {
            String sessionId = intent.getStringExtra(EXTRA_MANUAL_LISTEN_SESSION_ID);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
            recordVoiceEvent("service_action_start_manual_listen", details);
            startManualListen(sessionId);
            return START_STICKY;
        }
        if (ACTION_RETARGET_ACTIVE_RECOGNITION.equals(action)) {
            String sessionId = intent.getStringExtra(EXTRA_MANUAL_LISTEN_SESSION_ID);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
            recordVoiceEvent("service_action_retarget_active_recognition", details);
            retargetActiveManualRecognition(sessionId);
            return START_STICKY;
        }
        if (ACTION_TOGGLE_MEDIA_BUTTONS.equals(action)) {
            applyConfig(config.withMediaButtonsEnabled(!config.mediaButtonsEnabled));
            return START_STICKY;
        }
        if (ACTION_CYCLE_AUDIO_MODE.equals(action)) {
            String currentMode = intent != null && intent.hasExtra(AssistantVoiceConfig.EXTRA_AUDIO_MODE)
                ? intent.getStringExtra(AssistantVoiceConfig.EXTRA_AUDIO_MODE)
                : config.audioMode;
            applyConfig(config.withAudioMode(nextNotificationAudioMode(currentMode)));
            return START_STICKY;
        }
        if (ACTION_NOTIFICATION_SPEAKER.equals(action)) {
            recordVoiceEvent("service_action_notification_play", eventDetailsWithNotification(intent));
            handleManualNotificationAction(intent, false);
            return START_STICKY;
        }
        if (ACTION_NOTIFICATION_MIC.equals(action)) {
            recordVoiceEvent("service_action_notification_speak", eventDetailsWithNotification(intent));
            handleManualNotificationAction(intent, true);
            return START_STICKY;
        }
        if (ACTION_NOTIFICATION_DISMISS.equals(action)) {
            recordVoiceEvent("service_action_notification_dismiss", eventDetailsWithNotification(intent));
            dismissDurableNotification(intent);
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
        boolean selectedSessionChanged =
            !previous.selectedSessionId.equals(updated.selectedSessionId);
        boolean audioModeChanged = !previous.audioMode.equals(updated.audioMode);
        boolean adapterUrlChanged = !previous.voiceAdapterBaseUrl.equals(updated.voiceAdapterBaseUrl);
        boolean assistantUrlChanged = !previous.assistantBaseUrl.equals(updated.assistantBaseUrl);

        if (!updated.isEnabled()) {
            clearQueuedVoiceItems();
            stopCurrentInteraction(false, "voice_mode_disabled");
            disconnectAdapterSocket();
            disconnectAssistantSocket();
            syncMediaSession();
            updateState(STATE_DISABLED, null);
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
        } else if (selectedSessionChanged && hasActiveInteraction()) {
            refreshNotification();
        } else if (!hasActiveInteraction()) {
            updateState(resolveInactiveState(), null);
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
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
            case KeyEvent.KEYCODE_HEADSETHOOK:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (shouldToggleMediaButtonToStop(runtimeState, hasActiveInteraction())) {
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

    static boolean shouldToggleMediaButtonToStop(String state, boolean hasActiveInteraction) {
        return shouldStopForMediaButtonToggle(state, hasActiveInteraction);
    }

    static boolean shouldDrainQueueAfterStop(String reason) {
        String normalizedReason = trim(reason);
        return !"manual_notification_preempt".equals(normalizedReason)
            && !"voice_mode_disabled".equals(normalizedReason);
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
        String displayedAudioMode = resolveDisplayedNotificationAudioMode(state, config.audioMode);
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
        PendingIntent cycleAudioModePendingIntent = PendingIntent.getService(
            this,
            3,
            cycleAudioModeIntent(this, displayedAudioMode),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        PendingIntent toggleMediaButtonsPendingIntent = PendingIntent.getService(
            this,
            4,
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
            cycleAudioModePendingIntent,
            toggleMediaButtonsPendingIntent,
            showSpeakAction,
            showStopAction,
            displayedAudioMode,
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
        PendingIntent cycleAudioModePendingIntent,
        PendingIntent toggleMediaButtonsPendingIntent,
        boolean showSpeakAction,
        boolean showStopAction,
        String audioMode,
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
        String displayedAudioMode = resolveDisplayedNotificationAudioMode(state, audioMode);
        int compactActionCount = 0;
        if (showStopAction) {
            builder.addAction(
                R.drawable.ic_notification_stop,
                context.getString(R.string.assistant_voice_notification_action_stop),
                stopInteractionPendingIntent
            );
            compactActionCount += 1;
        } else if (showSpeakAction) {
            builder.addAction(
                android.R.drawable.ic_btn_speak_now,
                context.getString(R.string.assistant_voice_notification_action_speak),
                startListenPendingIntent
            );
            compactActionCount += 1;
        }
        builder.addAction(
            resolveNotificationMediaButtonsActionIcon(mediaButtonsEnabled),
            "",
            toggleMediaButtonsPendingIntent
        );
        compactActionCount += 1;
        builder.addAction(
            resolveNotificationAudioModeActionIcon(displayedAudioMode),
            resolveNotificationAudioModeActionLabel(
                context,
                displayedAudioMode
            ),
            cycleAudioModePendingIntent
        );
        compactActionCount += 1;
        builder.setStyle(
            compactActionCount >= 3
                ? new MediaStyle().setShowActionsInCompactView(0, 1, 2)
                : new MediaStyle().setShowActionsInCompactView(0, 1)
        );
        return builder.build();
    }

    static int resolveNotificationMediaButtonsActionIcon(boolean mediaButtonsEnabled) {
        return mediaButtonsEnabled
            ? R.drawable.ic_notification_media_buttons_enabled
            : R.drawable.ic_notification_media_buttons_disabled;
    }

    static int resolveNotificationAudioModeActionIcon(String audioMode) {
        switch (trim(audioMode)) {
            case AssistantVoiceConfig.AUDIO_MODE_RESPONSE:
                return R.drawable.ic_notification_mode_response;
            case AssistantVoiceConfig.AUDIO_MODE_OFF:
                return R.drawable.ic_notification_mode_off;
            case AssistantVoiceConfig.AUDIO_MODE_TOOL:
            default:
                return R.drawable.ic_notification_mode_tool;
        }
    }

    static String resolveNotificationAudioModeActionLabel(Context context, String audioMode) {
        switch (trim(audioMode)) {
            case AssistantVoiceConfig.AUDIO_MODE_RESPONSE:
                return context.getString(R.string.assistant_voice_notification_audio_mode_response);
            case AssistantVoiceConfig.AUDIO_MODE_OFF:
                return context.getString(R.string.assistant_voice_notification_audio_mode_off);
            case AssistantVoiceConfig.AUDIO_MODE_TOOL:
            default:
                return context.getString(R.string.assistant_voice_notification_audio_mode_tool);
        }
    }

    static String resolveDisplayedNotificationAudioMode(String state, String audioMode) {
        return STATE_DISABLED.equals(trim(state))
            ? AssistantVoiceConfig.AUDIO_MODE_OFF
            : trim(audioMode);
    }

    static String nextNotificationAudioMode(String audioMode) {
        switch (trim(audioMode)) {
            case AssistantVoiceConfig.AUDIO_MODE_TOOL:
                return AssistantVoiceConfig.AUDIO_MODE_RESPONSE;
            case AssistantVoiceConfig.AUDIO_MODE_RESPONSE:
                return AssistantVoiceConfig.AUDIO_MODE_OFF;
            case AssistantVoiceConfig.AUDIO_MODE_OFF:
            default:
                return AssistantVoiceConfig.AUDIO_MODE_TOOL;
        }
    }

    private void createNotificationChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        ensureNotificationChannel(this, manager);
        ensureDurableNotificationChannel(this, manager);
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

    static void ensureDurableNotificationChannel(Context context, NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || manager == null) {
            return;
        }
        NotificationChannel channel = manager.getNotificationChannel(DURABLE_NOTIFICATION_CHANNEL_ID);
        if (channel != null) {
            return;
        }
        manager.createNotificationChannel(
            new NotificationChannel(
                DURABLE_NOTIFICATION_CHANNEL_ID,
                context.getString(R.string.assistant_voice_durable_notification_channel_name),
                DURABLE_NOTIFICATION_CHANNEL_IMPORTANCE
            )
        );
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
                    Log.d(TAG, "adapter socket opened");
                    adapterSocketConnected = true;
                    sendAdapterClientState();
                    if (!hasActiveInteraction() && isRuntimeConnected()) {
                        updateState(STATE_IDLE, null);
                        drainVoiceQueueIfPossible();
                    }
                });
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                mainHandler.post(() -> handleAdapterMessage(webSocket, text));
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                Log.d(TAG, "adapter socket closed code=" + code + " reason=" + safe(reason));
                mainHandler.post(() -> handleAdapterSocketClosed(webSocket, "closed"));
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                Log.w(
                    TAG,
                    "adapter socket failure responseCode=" + (response == null ? 0 : response.code()),
                    t
                );
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
                    Log.d(TAG, "assistant socket opened watchedSessionCount=" + config.watchedSessionIds.size());
                    assistantSocketConnected = true;
                    assistantSubscribedSessionIds.clear();
                    webSocket.send(
                        AssistantVoiceSessionSocketProtocol.buildHelloMessage(
                            config.watchedSessionIds,
                            config.audioMode
                        )
                    );
                    refreshWatchedSessionsAsync();
                    refreshDurableNotificationsAsync();
                    if (!hasActiveInteraction() && isRuntimeConnected()) {
                        updateState(STATE_IDLE, null);
                        drainVoiceQueueIfPossible();
                    }
                });
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                mainHandler.post(() -> handleAssistantSocketMessage(webSocket, text));
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                Log.d(TAG, "assistant socket closed code=" + code + " reason=" + safe(reason));
                mainHandler.post(() -> handleAssistantSocketClosed(webSocket, "closed"));
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                Log.w(
                    TAG,
                    "assistant socket failure responseCode=" + (response == null ? 0 : response.code()),
                    t
                );
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

        AssistantVoiceNotificationEventParser.NotificationUpdate notificationUpdate =
            AssistantVoiceNotificationEventParser.parsePanelEvent(rawText);
        if (notificationUpdate != null) {
            Log.d(
                TAG,
                "assistant socket notification event type=" + safe(notificationUpdate.eventType)
                    + " id=" + safe(notificationUpdate.id)
                    + " count=" + (notificationUpdate.notifications == null ? 0 : notificationUpdate.notifications.size())
                    + (notificationUpdate.notification == null
                        ? ""
                        : " " + describeNotification(notificationUpdate.notification))
            );
            handleNotificationUpdate(notificationUpdate);
            return;
        }

        String subscribedSessionId =
            AssistantVoiceSessionSocketProtocol.parseSubscriptionSessionId(rawText, "subscribed");
        if (!subscribedSessionId.isEmpty()) {
            Log.d(TAG, "assistant socket subscribed sessionId=" + subscribedSessionId);
            assistantSubscribedSessionIds.add(subscribedSessionId);
            if (!hasActiveInteraction() && isRuntimeConnected()) {
                updateState(STATE_IDLE, null);
            }
            return;
        }

        String unsubscribedSessionId =
            AssistantVoiceSessionSocketProtocol.parseSubscriptionSessionId(rawText, "unsubscribed");
        if (!unsubscribedSessionId.isEmpty()) {
            Log.d(TAG, "assistant socket unsubscribed sessionId=" + unsubscribedSessionId);
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
            return;
        }

        AssistantVoicePromptEvent prompt =
            AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(rawText);
        if (prompt != null) {
            Log.d(
                TAG,
                "assistant socket prompt event sessionId=" + safe(prompt.sessionId)
                    + " toolName=" + safe(prompt.toolName)
                    + " eventId=" + safe(prompt.eventId)
                    + " toolCallId=" + safe(prompt.toolCallId)
                    + " textLength=" + trim(prompt.text).length()
            );
            handlePromptEvent(prompt);
            return;
        }

        if (!messageType.isEmpty()) {
            Log.d(TAG, "assistant socket unhandled message type=" + messageType);
        }
    }

    private void refreshDurableNotificationsAsync() {
        if (destroyed) {
            return;
        }
        networkExecutor.execute(() -> {
            List<AssistantVoiceNotificationRecord> notifications = fetchDurableNotifications();
            mainHandler.post(() -> applyDurableNotificationSnapshot(notifications));
        });
    }

    private List<AssistantVoiceNotificationRecord> fetchDurableNotifications() {
        try {
            JSONObject body = new JSONObject();
            String response = postJson(
                AssistantVoiceUrlUtils.assistantNotificationListUrl(config.assistantBaseUrl),
                body
            );
            return AssistantVoiceNotificationEventParser.parseListResponse(response);
        } catch (Exception error) {
            Log.w(TAG, "Failed to refresh durable notifications", error);
            return new ArrayList<>(durableNotifications.values());
        }
    }

    private void handleNotificationUpdate(
        AssistantVoiceNotificationEventParser.NotificationUpdate update
    ) {
        if (update == null) {
            return;
        }
        switch (update.eventType) {
            case "snapshot":
                applyDurableNotificationSnapshot(update.notifications);
                return;
            case "created":
            case "upserted":
                if (update.notification == null) {
                    return;
                }
                durableNotifications.put(update.notification.id, update.notification);
                showDurableNotification(update.notification);
                enqueueAutomaticNotification(update.notification);
                return;
            case "updated":
                if (update.notification == null) {
                    return;
                }
                durableNotifications.put(update.notification.id, update.notification);
                if (shouldDisplayDurableNotification(update.notification)) {
                    showDurableNotification(update.notification);
                } else {
                    cancelDurableNotification(update.notification.id);
                }
                return;
            case "removed":
                if (update.id.isEmpty()) {
                    return;
                }
                durableNotifications.remove(update.id);
                cancelDurableNotification(update.id);
                removeQueuedItemsForNotification(update.id);
                return;
            default:
                return;
        }
    }

    private void handlePromptEvent(AssistantVoicePromptEvent prompt) {
        if (prompt == null) {
            return;
        }
        if (!isWatchedSessionId(prompt.sessionId)) {
            Log.d(TAG, "handlePromptEvent skipped unwatched sessionId=" + safe(prompt.sessionId));
            return;
        }
        if (config.ttsPreferredSessionOnly
            && !config.preferredVoiceSessionId.isEmpty()
            && !prompt.sessionId.equals(config.preferredVoiceSessionId)) {
            Log.d(
                TAG,
                "handlePromptEvent skipped preferred-session filter sessionId=" + safe(prompt.sessionId)
                    + " preferred=" + safe(config.preferredVoiceSessionId)
            );
            return;
        }
        boolean shouldAutoplay = AssistantVoiceInteractionRules.shouldAutoplayEvent(
            config.audioMode,
            prompt,
            !hasActiveInteraction() && !isManualPreemptStopInFlight()
        );
        Log.d(
            TAG,
            "handlePromptEvent decision shouldAutoplay=" + shouldAutoplay
                + " audioMode=" + safe(config.audioMode)
                + " autoListenEnabled=" + config.autoListenEnabled
                + " hasActiveInteraction=" + hasActiveInteraction()
                + " pendingPreemptStop=" + isManualPreemptStopInFlight()
        );
        if (!shouldAutoplay) {
            return;
        }
        AssistantVoiceQueueItem item =
            AssistantVoiceQueueItem.fromPrompt(
                prompt,
                config.autoListenEnabled,
                config.notificationTitlePlaybackEnabled,
                config.getSessionTitle(prompt.sessionId)
            );
        if (item == null) {
            Log.d(TAG, "handlePromptEvent skipped prompt with no queue item");
            return;
        }
        enqueueQueueItem(item, false);
    }

    private void applyDurableNotificationSnapshot(List<AssistantVoiceNotificationRecord> notifications) {
        Set<String> previousIds = new LinkedHashSet<>(durableNotifications.keySet());
        durableNotifications.clear();
        if (notifications != null) {
            for (AssistantVoiceNotificationRecord notification : notifications) {
                if (notification != null) {
                    durableNotifications.put(notification.id, notification);
                }
            }
        }
        reconcileDurableNotifications(previousIds);
    }

    private void reconcileDurableNotifications(Set<String> previousIds) {
        if (previousIds != null) {
            for (String previousId : previousIds) {
                if (!durableNotifications.containsKey(previousId)) {
                    cancelDurableNotification(previousId);
                }
            }
        }
        for (AssistantVoiceNotificationRecord notification : durableNotifications.values()) {
            if (shouldDisplayDurableNotification(notification)) {
                showDurableNotification(notification);
            } else {
                cancelDurableNotification(notification.id);
            }
        }
    }

    private boolean shouldDisplayDurableNotification(AssistantVoiceNotificationRecord notification) {
        return notification != null
            && notification.isUnread()
            && (notification.isSessionAttention()
                || notification.isSessionLinked()
                || !"none".equals(notification.voiceMode));
    }

    private void showDurableNotification(AssistantVoiceNotificationRecord notification) {
        if (!shouldDisplayDurableNotification(notification)) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (notification.isSessionLinked()) {
            launchIntent.putExtra(EXTRA_OPEN_SESSION_ID, notification.sessionId);
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            durableNotificationRequestCode(notification.id, 0),
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        String displayTitle = resolveDurableNotificationTitle(notification);
        NotificationCompat.Builder builder =
            new NotificationCompat.Builder(this, DURABLE_NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(displayTitle)
                .setContentText(notification.body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(notification.body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setDeleteIntent(
                    PendingIntent.getService(
                        this,
                        durableNotificationRequestCode(notification.id, 1),
                        notificationDismissIntent(this, notification),
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                    )
                );
        if (!notification.sessionTitle.isEmpty() && !displayTitle.equals(notification.sessionTitle)) {
            builder.setSubText(notification.sessionTitle);
        }
        if (!resolveNotificationSpokenText(notification).isEmpty()) {
            builder.addAction(
                android.R.drawable.ic_btn_speak_now,
                getString(R.string.assistant_voice_notification_action_play),
                PendingIntent.getService(
                    this,
                    durableNotificationRequestCode(notification.id, 2),
                    notificationSpeakerIntent(this, notification),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                )
            );
        }
        if (notification.isSessionLinked()) {
            builder.addAction(
                android.R.drawable.ic_btn_speak_now,
                getString(R.string.assistant_voice_notification_action_speak),
                PendingIntent.getService(
                    this,
                    durableNotificationRequestCode(notification.id, 3),
                    notificationMicIntent(this, notification),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                )
            );
        }
        manager.notify(durableNotificationId(notification.id), builder.build());
    }

    private String resolveDurableNotificationTitle(AssistantVoiceNotificationRecord notification) {
        if (notification.isSessionAttention()) {
            if (!notification.sessionTitle.isEmpty()) {
                return notification.sessionTitle;
            }
            String configTitle = config.getSessionTitle(notification.sessionId);
            if (!configTitle.isEmpty()) {
                return configTitle;
            }
        }
        return notification.title;
    }

    private String resolveNotificationSpokenTitle(AssistantVoiceNotificationRecord notification) {
        if (notification == null) {
            return "";
        }
        if (notification.isSessionLinked()) {
            if (!notification.sessionTitle.isEmpty()) {
                return notification.sessionTitle;
            }
            String configTitle = config.getSessionTitle(notification.sessionId);
            if (!configTitle.isEmpty()) {
                return configTitle;
            }
        }
        return notification.title;
    }

    private String resolveNotificationSpokenText(AssistantVoiceNotificationRecord notification) {
        if (notification == null) {
            return "";
        }
        return notification.resolveSpokenText(
            config.notificationTitlePlaybackEnabled,
            resolveNotificationSpokenTitle(notification)
        );
    }

    private void cancelDurableNotification(String notificationId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(durableNotificationId(notificationId));
        }
    }

    private void enqueueAutomaticNotification(AssistantVoiceNotificationRecord notification) {
        if (!config.isEnabled()
            || !isRuntimeConnected()
            || notification == null
            || !AssistantVoiceInteractionRules.shouldAutoplayNotification(
                config.audioMode,
                config.standaloneNotificationPlaybackEnabled,
                notification
            )) {
            return;
        }
        if (config.ttsPreferredSessionOnly
            && !config.preferredVoiceSessionId.isEmpty()
            && !config.preferredVoiceSessionId.equals(notification.sessionId)) {
            return;
        }
        AssistantVoiceQueueItem item = notification.toAutomaticQueueItem(
            config.autoListenEnabled,
            config.notificationTitlePlaybackEnabled,
            resolveNotificationSpokenTitle(notification)
        );
        if (item == null) {
            return;
        }
        enqueueQueueItem(item, false);
    }

    private void enqueueQueueItem(AssistantVoiceQueueItem item, boolean front) {
        if (item == null || (item.requiresSession() && item.sessionId.isEmpty())) {
            Log.d(TAG, "enqueueQueueItem dropped invalid item=" + describeQueueItem(item));
            return;
        }
        String dedupKey = item.dedupKey();
        if (!dedupKey.isEmpty()) {
            if (activeQueueItem != null && dedupKey.equals(activeQueueItem.dedupKey())) {
                Log.d(TAG, "enqueueQueueItem deduped active item=" + describeQueueItem(item));
                return;
            }
            for (AssistantVoiceQueueItem queued : queuedVoiceItems) {
                if (dedupKey.equals(queued.dedupKey())) {
                    Log.d(TAG, "enqueueQueueItem deduped queued item=" + describeQueueItem(item));
                    return;
                }
            }
        }
        if (item.isSessionAttention()) {
            removePendingSessionAttention(item.sessionId);
        }
        while (queuedVoiceItems.size() >= MAX_PENDING_QUEUE_ITEMS) {
            queuedVoiceItems.remove(queuedVoiceItems.size() - 1);
        }
        if (front) {
            queuedVoiceItems.add(0, item);
        } else {
            queuedVoiceItems.add(item);
        }
        Log.d(
            TAG,
            "enqueueQueueItem queued front=" + front
                + " size=" + queuedVoiceItems.size()
                + " " + describeQueueItem(item)
        );
        drainVoiceQueueIfPossible();
    }

    private void removePendingSessionAttention(String sessionId) {
        String normalizedSessionId = trim(sessionId);
        for (int index = queuedVoiceItems.size() - 1; index >= 0; index -= 1) {
            AssistantVoiceQueueItem item = queuedVoiceItems.get(index);
            if (item.isSessionAttention() && normalizedSessionId.equals(item.sessionId)) {
                queuedVoiceItems.remove(index);
            }
        }
    }

    private void removeQueuedItemsForNotification(String notificationId) {
        String normalizedId = trim(notificationId);
        for (int index = queuedVoiceItems.size() - 1; index >= 0; index -= 1) {
            if (normalizedId.equals(queuedVoiceItems.get(index).notificationId)) {
                queuedVoiceItems.remove(index);
            }
        }
    }

    private void clearQueuedVoiceItems() {
        queuedVoiceItems.clear();
    }

    private void drainVoiceQueueIfPossible() {
        String blockedReason = explainQueueDrainBlock();
        if (!blockedReason.isEmpty()) {
            Log.d(TAG, "drainVoiceQueueIfPossible blocked reason=" + blockedReason + " " + describeRuntimeState());
            return;
        }
        AssistantVoiceQueueItem next = queuedVoiceItems.remove(0);
        Log.d(TAG, "drainVoiceQueueIfPossible starting " + describeQueueItem(next));
        if (next.isListenOnly()) {
            activeQueueItem = next;
            startRecognition(next.sessionId, "manual_notification_mic");
            return;
        }
        beginQueuedPlayback(next);
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
                Log.d(TAG, "adapter client_identity clientIdPresent=" + !adapterClientId.isEmpty());
                if (!hasActiveInteraction()) {
                    updateState(STATE_IDLE, null);
                }
                return;
            }
            if ("media_tts_audio_chunk".equals(type)) {
                String requestId = trim(message.optString("requestId"));
                String chunkBase64 = message.optString("chunkBase64");
                int decodedBytes = estimateBase64DecodedBytes(chunkBase64);
                Log.d(
                    TAG,
                    "adapter media_tts_audio_chunk requestId=" + requestId
                        + " active=" + activeTtsRequestId
                        + " chunkLength=" + trim(chunkBase64).length()
                        + " decodedBytes=" + decodedBytes
                );
                if (requestId.equals(activeTtsRequestId)) {
                    activeTtsSampleRate = Math.max(0, message.optInt("sampleRate", 0));
                    activeTtsAudioChunkCount += 1;
                    activeTtsAudioBytes += decodedBytes;
                    player.enqueueChunk(
                        requestId,
                        chunkBase64,
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
        boolean matchesActiveRequest = requestId.equals(activeTtsRequestId);
        boolean matchesManualPreemptStop = requestId.equals(pendingManualPreemptStopRequestId);
        if (!matchesActiveRequest && !matchesManualPreemptStop) {
            Log.d(
                TAG,
                "ignoring media_tts_end requestId=" + requestId
                    + " active=" + activeTtsRequestId
                    + " pendingPreemptStop=" + pendingManualPreemptStopRequestId
            );
            return;
        }
        String status = trim(message.optString("status"));
        String error = trim(message.optString("error"));
        boolean startsListening =
            activeQueueItem != null
                ? activeQueueItem.startsListeningAfterPlayback()
                : AssistantVoiceInteractionRules.shouldStartRecognitionAfterPlayback(
                    activePromptToolName,
                    config.autoListenEnabled
                );
        Log.d(
            TAG,
            "handleTtsEnd requestId=" + requestId
                + " status=" + safe(status)
                + " error=" + safe(error)
                + " startsListening=" + startsListening
                + " activeQueueItem=" + describeQueueItem(activeQueueItem)
        );
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "status", safe(status));
        AssistantVoiceEventLog.put(details, "error", safe(error));
        AssistantVoiceEventLog.put(details, "startsListening", startsListening);
        AssistantVoiceEventLog.put(details, "textLength", activeTtsTextLength);
        AssistantVoiceEventLog.put(details, "sampleRate", activeTtsSampleRate);
        AssistantVoiceEventLog.put(details, "audioChunkCount", activeTtsAudioChunkCount);
        AssistantVoiceEventLog.put(details, "audioBytes", activeTtsAudioBytes);
        recordVoiceEvent("tts_end", details);
        if (matchesManualPreemptStop && !matchesActiveRequest) {
            pendingManualPreemptStopRequestId = "";
            enqueuePendingManualPreemptQueueItem("media_tts_end:" + safe(status));
            return;
        }
        activeTtsRequestId = "";

        if ("completed".equals(status)) {
            pendingPlaybackDrainRequestId = requestId;
            pendingPlaybackDrainStartsListening = startsListening;
            schedulePlaybackDrainTimeout(
                requestId,
                activeTtsAudioBytes,
                activeTtsSampleRate
            );
            player.finishStream(requestId);
            return;
        }

        player.stop();
        clearPlaybackDrainTimeout(requestId);
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        clearActivePromptContext();
        finishActiveQueueItem(true);
        if ("failed".equals(status)) {
            emitRuntimeError(
                error.isEmpty() ? "Voice playback failed" : "Voice playback failed: " + error
            );
        }
        if (!hasActiveInteraction()) {
            updateState(resolveInactiveState(), null);
        }
    }

    private void handlePlaybackDrained(String requestId) {
        clearPlaybackDrainTimeout(requestId);
        String completionCueRequestId = extractRecognitionCompletionCueRequestId(requestId);
        if (!completionCueRequestId.isEmpty()) {
            if (!requestId.equals(trim(pendingRecognitionCompletionCuePlaybackRequestId))) {
                return;
            }
            handleRecognitionCompletionCueFinished(requestId, "");
            return;
        }
        String failureRetrySessionId = extractRecognitionFailureRetrySessionId(requestId);
        if (!failureRetrySessionId.isEmpty()) {
            if (!failureRetrySessionId.equals(trim(pendingRecognitionFailureRetrySessionId))) {
                return;
            }
            pendingRecognitionFailureRetrySessionId = "";
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
            AssistantVoiceEventLog.put(details, "sessionId", safe(failureRetrySessionId));
            recordVoiceEvent("recognition_retry_start", details);
            startRecognition(failureRetrySessionId, "empty_transcript_retry");
            return;
        }
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
            if (activeQueueItem == null) {
                Log.d(
                    TAG,
                    "handlePlaybackDrained starting recognition for prompt sessionId="
                        + safe(activeVoiceSessionId)
                );
                startRecognition(activeVoiceSessionId, "playback_completion");
                return;
            }
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
            AssistantVoiceEventLog.put(details, "queueItem", describeQueueItem(activeQueueItem));
            recordVoiceEvent("playback_drained_queue_validation", details);
            validateQueuedRecognitionAndMaybeStart(requestId);
            return;
        }
        clearActivePromptContext();
        finishActiveQueueItem(true);
        if (!hasActiveInteraction()) {
            updateState(resolveInactiveState(), null);
        }
    }

    private void handleSttResult(JSONObject message) {
        String requestId = trim(message.optString("requestId"));
        if (!requestId.equals(activeSttRequestId)) {
            Log.d(TAG, "ignoring media_stt_result requestId=" + requestId + " active=" + activeSttRequestId);
            return;
        }

        String sessionId = resolveRecognitionSubmitSessionId(activeVoiceSessionId);
        boolean success = message.optBoolean("success", false);
        boolean canceled = message.optBoolean("canceled", false);
        String text = trim(message.optString("text"));
        String error = trim(message.optString("error"));
        int durationMs = Math.max(0, message.optInt("durationMs", 0));
        boolean localStopCommand = shouldHandleRecognizedStopCommand(
            success,
            text,
            config.recognizeStopCommandEnabled
        );
        boolean shouldRetryAfterFailure = shouldRetryRecognitionAfterEmptyTranscript(
            success,
            canceled,
            error,
            sessionId
        );
        boolean positiveCue = shouldUsePositiveRecognitionCue(success, text);
        boolean captureAlreadyStopped =
            shouldScheduleQueuedRecognitionCompletionCueAfterResult(
                stoppedRecognitionRequestId,
                requestId
            );

        activeSttRequestId = "";
        queueRecognitionCompletionCue(
            requestId,
            positiveCue && !localStopCommand,
            shouldRetryAfterFailure
                ? buildRecognitionFailureRetryCueRequestId(sessionId)
                : ""
        );
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
                + " localStopCommand=" + localStopCommand
                + " error=" + error
        );
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.put(details, "success", success);
        AssistantVoiceEventLog.put(details, "canceled", canceled);
        AssistantVoiceEventLog.put(details, "textLength", text.length());
        AssistantVoiceEventLog.put(details, "durationMs", durationMs);
        AssistantVoiceEventLog.put(details, "localStopCommand", localStopCommand);
        AssistantVoiceEventLog.put(details, "error", safe(error));
        recordVoiceEvent("stt_result", details);

        clearActivePromptContext();
        if (shouldBlockQueueDuringRecognitionSubmit(config.audioMode, sessionId, positiveCue)) {
            beginPendingRecognitionSubmit(sessionId);
        }
        finishActiveQueueItem(true);
        if (!hasActiveInteraction()) {
            updateState(resolveInactiveState(), null);
        }

        if (localStopCommand) {
            return;
        }
        if (positiveCue && !sessionId.isEmpty()) {
            submitRecognizedSpeech(sessionId, text, durationMs);
            return;
        }
        if (shouldRetryAfterFailure) {
            JSONObject retryDetails = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(retryDetails, "requestId", safe(requestId));
            AssistantVoiceEventLog.put(retryDetails, "sessionId", safe(sessionId));
            AssistantVoiceEventLog.put(retryDetails, "error", safe(error));
            recordVoiceEvent("recognition_retry_scheduled", retryDetails);
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

    private void beginQueuedPlayback(AssistantVoiceQueueItem item) {
        if (item == null) {
            Log.d(TAG, "beginQueuedPlayback skipped item=<null>");
            return;
        }
        if (!config.isEnabled()) {
            Log.d(TAG, "beginQueuedPlayback skipped voice mode disabled " + describeQueueItem(item));
            return;
        }
        if (hasActiveInteraction()) {
            Log.d(TAG, "beginQueuedPlayback skipped active interaction " + describeRuntimeState());
            return;
        }
        if (!item.hasSpeech()) {
            Log.d(TAG, "beginQueuedPlayback skipped no speech " + describeQueueItem(item));
            return;
        }
        if (!adapterSocketConnected) {
            Log.d(TAG, "beginQueuedPlayback waiting for adapter socket " + describeQueueItem(item));
            return;
        }

        String requestId = UUID.randomUUID().toString();
        Log.d(
            TAG,
            "beginQueuedPlayback requestId=" + requestId
                + " adapterClientIdPresent=" + !adapterClientId.isEmpty()
                + " " + describeQueueItem(item)
        );
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "queueItem", describeQueueItem(item));
        AssistantVoiceEventLog.put(details, "textLength", trim(item.spokenText).length());
        recordVoiceEvent("tts_begin", details);
        activeQueueItem = item;
        activeVoiceSessionId = item.sessionId;
        activePromptToolName = item.executionMode;
        activeTtsRequestId = requestId;
        activeTtsTextLength = trim(item.spokenText).length();
        activeTtsAudioChunkCount = 0;
        activeTtsAudioBytes = 0;
        activeTtsSampleRate = 0;
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        if (STATE_SPEAKING.equals(runtimeState)) {
            syncRuntimeSnapshot(true);
        }
        player.startStream(requestId);
        updateState(STATE_SPEAKING, null);

        networkExecutor.execute(() -> {
            try {
                JSONObject body = buildAdapterTtsRequestBody(
                    adapterClientId,
                    requestId,
                    item.spokenText,
                    item.sessionId
                );
                Log.d(
                    TAG,
                    "dispatching adapter TTS requestId=" + requestId
                        + " clientIdPresent=" + body.has("clientId")
                        + " textLength=" + trim(item.spokenText).length()
                );
                postJson(AssistantVoiceUrlUtils.adapterTtsUrl(config.voiceAdapterBaseUrl), body);
            } catch (Exception error) {
                Log.w(TAG, "adapter TTS request failed requestId=" + requestId, error);
                mainHandler.post(() -> {
                    if (!requestId.equals(activeTtsRequestId)) {
                        return;
                    }
                    activeTtsRequestId = "";
                    clearActivePromptContext();
                    finishActiveQueueItem(true);
                    player.stop();
                    updateStateIfNoActiveInteraction();
                    clearPendingManualPreemptState("tts_request_failure");
                    emitRuntimeError("Voice playback request failed");
                });
            }
        });
    }

    private void stopCurrentInteraction(boolean transitionToRecognition, String reason) {
        String ttsRequestId = activeTtsRequestId;
        String listeningRequestId = activeSttRequestId;
        String speakingSessionId = activeVoiceSessionId;
        AssistantVoiceQueueItem interruptedQueueItem = activeQueueItem;
        Log.d(
            TAG,
            "stopCurrentInteraction reason=" + reason
                + " transitionToRecognition=" + transitionToRecognition
                + " ttsRequestId=" + safe(ttsRequestId)
                + " sttRequestId=" + safe(listeningRequestId)
                + " activeSessionId=" + safe(speakingSessionId)
                + " activeQueueItem=" + describeQueueItem(interruptedQueueItem)
        );
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "reason", safe(reason));
        AssistantVoiceEventLog.put(details, "transitionToRecognition", transitionToRecognition);
        AssistantVoiceEventLog.put(details, "ttsRequestId", safe(ttsRequestId));
        AssistantVoiceEventLog.put(details, "sttRequestId", safe(listeningRequestId));
        AssistantVoiceEventLog.put(details, "activeSessionId", safe(speakingSessionId));
        AssistantVoiceEventLog.put(details, "interruptedQueueItem", describeQueueItem(interruptedQueueItem));
        recordVoiceEvent("stop_current_interaction", details);
        boolean playManualStopCue =
            "manual_stop".equals(reason) && !listeningRequestId.isEmpty();
        boolean pendingArmingCue =
            listeningRequestId.equals(pendingRecognitionArmingCueRequestId);

        activeTtsRequestId = "";
        pendingPlaybackDrainRequestId = "";
        pendingPlaybackDrainStartsListening = false;
        clearPlaybackDrainTimeout("");
        pendingRecognitionArmingCueRequestId = "";
        player.stop();

        if (!ttsRequestId.isEmpty()) {
            if ("manual_notification_preempt".equals(reason)) {
                pendingManualPreemptStopRequestId = ttsRequestId;
            } else {
                clearPendingManualPreemptState("stop_current_interaction:" + reason);
            }
            requestAdapterTtsStop(ttsRequestId);
        } else if (!"manual_notification_preempt".equals(reason)) {
            clearPendingManualPreemptState("stop_current_interaction_no_tts:" + reason);
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
            boolean allowPromptFollowup =
                interruptedQueueItem != null
                    ? interruptedQueueItem.startsListeningAfterPlayback()
                        || "manual_listen".equals(reason)
                    : AssistantVoiceInteractionRules.shouldStartRecognitionAfterManualStop(
                        activePromptToolName,
                        "manual_listen".equals(reason),
                        config.autoListenEnabled
                    );
            if (allowPromptFollowup) {
                activeQueueItem = interruptedQueueItem != null ? interruptedQueueItem : activeQueueItem;
                startRecognition(speakingSessionId, reason);
                return;
            }
        }

        clearActivePromptContext();
        boolean shouldDrainQueue = shouldDrainQueueAfterStop(reason);
        finishActiveQueueItem(shouldDrainQueue);
        if (!hasActiveInteraction()) {
            updateState(resolveInactiveState(), null);
        }
    }

    private void startManualListen(String requestedSessionId) {
        String targetSessionId = trim(requestedSessionId);
        if (targetSessionId.isEmpty()) {
            targetSessionId = config.preferredVoiceSessionId;
        }
        if (!config.isEnabled() || targetSessionId.isEmpty()) {
            Log.d(
                TAG,
                "startManualListen skipped enabled=" + config.isEnabled()
                    + " requestedSessionId=" + safe(requestedSessionId)
                    + " targetSessionId=" + safe(targetSessionId)
            );
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "requestedSessionId", safe(requestedSessionId));
            AssistantVoiceEventLog.put(details, "targetSessionId", safe(targetSessionId));
            recordVoiceEvent("manual_listen_skipped", details);
            return;
        }
        if (isPromptPlaybackActive()) {
            Log.d(TAG, "startManualListen interrupting active playback targetSessionId=" + targetSessionId);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "targetSessionId", safe(targetSessionId));
            recordVoiceEvent("manual_listen_interrupt_playback", details);
            stopCurrentInteraction(true, "manual_listen");
            return;
        }
        if (!activeSttRequestId.isEmpty()) {
            Log.d(TAG, "startManualListen skipped activeSttRequestId=" + activeSttRequestId);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "targetSessionId", safe(targetSessionId));
            AssistantVoiceEventLog.put(details, "activeSttRequestId", safe(activeSttRequestId));
            recordVoiceEvent("manual_listen_skipped_active_stt", details);
            return;
        }
        Log.d(TAG, "startManualListen starting targetSessionId=" + targetSessionId);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "targetSessionId", safe(targetSessionId));
        recordVoiceEvent("manual_listen_start", details);
        startRecognition(targetSessionId, "manual_listen");
    }

    private void startRecognition(String sessionId, String reason) {
        if (sessionId == null || sessionId.trim().isEmpty()) {
            Log.d(TAG, "startRecognition skipped empty sessionId reason=" + reason);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "reason", safe(reason));
            recordVoiceEvent("recognition_start_skipped_empty_session", details);
            return;
        }
        if (!config.isEnabled() || !adapterSocketConnected || adapterSocket == null) {
            Log.d(
                TAG,
                "startRecognition blocked reason=" + reason
                    + " enabled=" + config.isEnabled()
                    + " adapterSocketConnected=" + adapterSocketConnected
                    + " adapterSocketPresent=" + (adapterSocket != null)
                    + " sessionId=" + trim(sessionId)
            );
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "sessionId", trim(sessionId));
            AssistantVoiceEventLog.put(details, "reason", safe(reason));
            AssistantVoiceEventLog.put(details, "adapterSocketConnected", adapterSocketConnected);
            AssistantVoiceEventLog.put(details, "adapterSocketPresent", adapterSocket != null);
            recordVoiceEvent("recognition_start_blocked", details);
            updateState(STATE_CONNECTING, null);
            return;
        }
        if (!activeSttRequestId.isEmpty()) {
            Log.d(TAG, "startRecognition skipped activeSttRequestId=" + activeSttRequestId + " reason=" + reason);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "sessionId", trim(sessionId));
            AssistantVoiceEventLog.put(details, "reason", safe(reason));
            AssistantVoiceEventLog.put(details, "activeSttRequestId", safe(activeSttRequestId));
            recordVoiceEvent("recognition_start_skipped_active_stt", details);
            return;
        }

        String requestId = UUID.randomUUID().toString();
        activeVoiceSessionId = sessionId.trim();
        activePromptToolName = "manual_listen".equals(reason) ? "voice_manual" : activePromptToolName;
        activeSttRequestId = requestId;
        resetRecognitionCueState();
        Log.d(TAG, "startRecognition requestId=" + requestId + " sessionId=" + activeVoiceSessionId + " reason=" + reason);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "sessionId", safe(activeVoiceSessionId));
        AssistantVoiceEventLog.put(details, "reason", safe(reason));
        recordVoiceEvent("recognition_start", details);

        if (micStreamer == null) {
            activeSttRequestId = "";
            playRecognitionCompletionCueIfNeeded(false);
            resetRecognitionCueState();
            clearActivePromptContext();
            updateState(resolveInactiveState(), null);
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
            Log.d(
                TAG,
                "startRecognitionCapture skipped requestId=" + safe(requestId)
                    + " activeSttRequestId=" + safe(activeSttRequestId)
                    + " micStreamerPresent=" + (micStreamer != null)
            );
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
            Log.w(TAG, "startRecognitionCapture failed requestId=" + requestId);
            player.endRecognitionCaptureFocus();
            activeSttRequestId = "";
            playRecognitionCompletionCueIfNeeded(false);
            resetRecognitionCueState();
            clearActivePromptContext();
            updateState(resolveInactiveState(), null);
            emitRuntimeError("Microphone capture is unavailable");
        }
    }

    private void requestAdapterTtsStop(String requestId) {
        if (!adapterSocketConnected || requestId == null || requestId.trim().isEmpty()) {
            Log.d(
                TAG,
                "requestAdapterTtsStop skipped requestId=" + safe(requestId)
                    + " adapterSocketConnected=" + adapterSocketConnected
            );
            return;
        }
        networkExecutor.execute(() -> {
            try {
                JSONObject body = buildAdapterTtsStopRequestBody(adapterClientId, requestId);
                Log.d(
                    TAG,
                    "dispatching adapter TTS stop requestId=" + requestId
                        + " clientIdPresent=" + body.has("clientId")
                );
                postJson(AssistantVoiceUrlUtils.adapterTtsStopUrl(config.voiceAdapterBaseUrl), body);
                mainHandler.post(() -> handleAdapterTtsStopAcknowledged(requestId));
            } catch (Exception error) {
                Log.w(TAG, "adapter TTS stop request failed requestId=" + requestId, error);
                mainHandler.post(() -> {
                    if (requestId.equals(pendingManualPreemptStopRequestId)) {
                        clearPendingManualPreemptState("tts_stop_failure");
                    }
                });
            }
        });
    }

    private void handleAdapterTtsStopAcknowledged(String requestId) {
        if (!requestId.equals(pendingManualPreemptStopRequestId)) {
            Log.d(
                TAG,
                "handleAdapterTtsStopAcknowledged ignored requestId=" + safe(requestId)
                    + " pending=" + safe(pendingManualPreemptStopRequestId)
            );
            return;
        }
        Log.d(
            TAG,
            "handleAdapterTtsStopAcknowledged requestId=" + requestId
                + " waitingForMediaTtsEnd=true"
        );
    }

    static JSONObject buildAdapterTtsRequestBody(
        String adapterClientId,
        String requestId,
        String text,
        String sessionId
    ) {
        JSONObject body = new JSONObject();
        putJson(body, "requestId", trim(requestId));
        putJson(body, "text", trim(text));
        String normalizedSessionId = trim(sessionId);
        if (!normalizedSessionId.isEmpty()) {
            putJson(body, "sessionId", normalizedSessionId);
        }
        String normalizedClientId = trim(adapterClientId);
        if (!normalizedClientId.isEmpty()) {
            putJson(body, "clientId", normalizedClientId);
        }
        return body;
    }

    static JSONObject buildAdapterTtsStopRequestBody(String adapterClientId, String requestId) {
        JSONObject body = new JSONObject();
        putJson(body, "requestId", trim(requestId));
        String normalizedClientId = trim(adapterClientId);
        if (!normalizedClientId.isEmpty()) {
            putJson(body, "clientId", normalizedClientId);
        }
        return body;
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
            String type = trim(message.optString("type"));
            if ("media_stt_start".equals(type)
                || "media_stt_end".equals(type)
                || "media_stt_cancel".equals(type)) {
                Log.d(
                    TAG,
                    "sent adapter message type=" + type
                        + " requestId=" + safe(message.optString("requestId"))
                );
            }
        } else {
            Log.d(
                TAG,
                "dropped adapter message connected=" + adapterSocketConnected
                    + " socketPresent=" + (adapterSocket != null)
                    + " type=" + safe(message == null ? null : message.optString("type"))
            );
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
        Log.d(
            TAG,
            "handleMicCaptureStarted requestId=" + requestId
                + " sampleRate=" + sampleRate
                + " channels=" + channels
                + " encoding=" + safe(encoding)
                + " startTimeoutMs=" + config.recognitionStartTimeoutMs
                + " completionTimeoutMs=" + config.recognitionCompletionTimeoutMs
                + " endSilenceMs=" + config.recognitionEndSilenceMs
        );
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "sampleRate", sampleRate);
        AssistantVoiceEventLog.put(details, "channels", channels);
        AssistantVoiceEventLog.put(details, "encoding", safe(encoding));
        recordVoiceEvent("mic_capture_started", details);
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
        Log.d(TAG, "handleMicCaptureStopped requestId=" + safe(requestId) + " active=" + safe(activeSttRequestId));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "activeSttRequestId", safe(activeSttRequestId));
        recordVoiceEvent("mic_capture_stopped", details);
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
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.put(details, "textLength", text.length());
        AssistantVoiceEventLog.put(details, "durationMs", durationMs);
        recordVoiceEvent("recognition_submit", details);
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
                recordVoiceEvent("recognition_submit_sent", details);
                mainHandler.post(() -> clearPendingRecognitionSubmit("submit_sent", true));
            } catch (Exception error) {
                Log.w(TAG, "submitRecognizedSpeech failed", error);
                JSONObject errorDetails = AssistantVoiceEventLog.details();
                AssistantVoiceEventLog.put(errorDetails, "sessionId", safe(sessionId));
                AssistantVoiceEventLog.put(errorDetails, "textLength", text.length());
                AssistantVoiceEventLog.put(errorDetails, "durationMs", durationMs);
                AssistantVoiceEventLog.put(errorDetails, "error", safe(error.getMessage()));
                recordVoiceEvent("recognition_submit_failed", errorDetails);
                mainHandler.post(() -> {
                    clearPendingRecognitionSubmit("submit_failed", true);
                    emitRuntimeError("Failed to submit recognized speech");
                });
            }
        });
    }

    static String resolveRecognitionSubmitSessionId(String activeSessionId) {
        return trim(activeSessionId);
    }

    static boolean shouldRetargetActiveManualRecognition(
        String previousSelectedSessionId,
        String updatedSelectedSessionId,
        String activeSttRequestId,
        String activePromptToolName
    ) {
        if (trim(activeSttRequestId).isEmpty()) {
            return false;
        }
        if (!"voice_manual".equals(trim(activePromptToolName))) {
            return false;
        }
        String normalizedUpdatedSelectedSessionId = trim(updatedSelectedSessionId);
        if (normalizedUpdatedSelectedSessionId.isEmpty()) {
            return false;
        }
        return !normalizedUpdatedSelectedSessionId.equals(trim(previousSelectedSessionId));
    }

    private void retargetActiveManualRecognition(String sessionId) {
        String normalizedSessionId = trim(sessionId);
        if (
            !shouldRetargetActiveManualRecognition(
                activeVoiceSessionId,
                normalizedSessionId,
                activeSttRequestId,
                activePromptToolName
            )
        ) {
            return;
        }
        String previousSessionId = activeVoiceSessionId;
        activeVoiceSessionId = normalizedSessionId;
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "previousSelectedSessionId", safe(previousSessionId));
        AssistantVoiceEventLog.put(details, "updatedSelectedSessionId", safe(normalizedSessionId));
        AssistantVoiceEventLog.put(details, "activeSttRequestId", safe(activeSttRequestId));
        recordVoiceEvent("manual_listen_retarget", details);
        syncRuntimeSnapshot(true);
    }

    private void finishActiveQueueItem(boolean drainQueue) {
        activeQueueItem = null;
        if (drainQueue) {
            drainVoiceQueueIfPossible();
        }
    }

    private void validateQueuedRecognitionAndMaybeStart(String requestId) {
        AssistantVoiceQueueItem queueItem = activeQueueItem;
        if (queueItem == null) {
            Log.d(TAG, "validateQueuedRecognitionAndMaybeStart missing active queue item requestId=" + requestId);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
            recordVoiceEvent("queued_recognition_missing_item", details);
            clearActivePromptContext();
            finishActiveQueueItem(true);
            updateStateIfNoActiveInteraction();
            return;
        }
        if (!queueItem.requiresListenValidation()) {
            Log.d(TAG, "validateQueuedRecognitionAndMaybeStart bypassed validation " + describeQueueItem(queueItem));
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
            AssistantVoiceEventLog.put(details, "queueItem", describeQueueItem(queueItem));
            recordVoiceEvent("queued_recognition_validation_bypassed", details);
            startRecognition(queueItem.sessionId, queueItem.manual ? "manual_notification_mic" : "playback_completion");
            return;
        }
        Integer expectedSeq = queueItem.sessionActivitySeq;
        Log.d(TAG, "validateQueuedRecognitionAndMaybeStart fetching current revision expectedSeq=" + expectedSeq + " " + describeQueueItem(queueItem));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "expectedSeq", expectedSeq);
        AssistantVoiceEventLog.put(details, "queueItem", describeQueueItem(queueItem));
        recordVoiceEvent("queued_recognition_validation_fetch", details);
        networkExecutor.execute(() -> {
            Integer currentSeq = fetchSessionActivityRevision(queueItem.sessionId);
            mainHandler.post(() -> {
                if (!requestId.equals(pendingPlaybackDrainRequestId) && activeQueueItem != queueItem) {
                    Log.d(TAG, "validateQueuedRecognitionAndMaybeStart stale requestId=" + requestId);
                    return;
                }
                Log.d(
                    TAG,
                    "validateQueuedRecognitionAndMaybeStart currentSeq=" + currentSeq
                        + " expectedSeq=" + expectedSeq
                        + " " + describeQueueItem(queueItem)
                );
                JSONObject resultDetails = AssistantVoiceEventLog.details();
                AssistantVoiceEventLog.put(resultDetails, "requestId", safe(requestId));
                AssistantVoiceEventLog.put(resultDetails, "expectedSeq", expectedSeq);
                AssistantVoiceEventLog.put(resultDetails, "currentSeq", currentSeq);
                AssistantVoiceEventLog.put(resultDetails, "queueItem", describeQueueItem(queueItem));
                if (expectedSeq != null && currentSeq != null && currentSeq.intValue() > expectedSeq.intValue()) {
                    Log.d(TAG, "validateQueuedRecognitionAndMaybeStart skipped stale notification " + describeQueueItem(queueItem));
                    recordVoiceEvent("queued_recognition_validation_stale", resultDetails);
                    clearActivePromptContext();
                    finishActiveQueueItem(true);
                    updateStateIfNoActiveInteraction();
                    return;
                }
                recordVoiceEvent("queued_recognition_validation_passed", resultDetails);
                startRecognition(
                    queueItem.sessionId,
                    queueItem.manual ? "manual_notification_mic" : "playback_completion"
                );
            });
        });
    }

    private Integer fetchSessionActivityRevision(String sessionId) {
        try {
            JSONObject body = new JSONObject();
            String response = postJson(
                AssistantVoiceUrlUtils.assistantSessionListUrl(config.assistantBaseUrl),
                body
            );
            JSONObject payload = new JSONObject(response);
            JSONObject result =
                payload.has("result") && payload.optJSONObject("result") != null
                    ? payload.optJSONObject("result")
                    : payload;
            if (result == null) {
                return null;
            }
            org.json.JSONArray sessions = result.optJSONArray("sessions");
            if (sessions == null) {
                return null;
            }
            for (int index = 0; index < sessions.length(); index += 1) {
                JSONObject session = sessions.optJSONObject(index);
                if (session == null) {
                    continue;
                }
                if (trim(session.optString("sessionId")).equals(trim(sessionId))) {
                    return session.has("revision") ? Integer.valueOf(session.optInt("revision")) : null;
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "Failed to fetch session activity revision", error);
        }
        return null;
    }

    private void handleManualNotificationAction(Intent intent, boolean microphoneAction) {
        AssistantVoiceNotificationRecord notification = notificationFromIntent(intent);
        if (!canHandleManualNotificationAction(notification, microphoneAction)) {
            Log.w(
                TAG,
                "handleManualNotificationAction missing notification microphoneAction=" + microphoneAction
            );
            return;
        }
        if (!config.isEnabled()) {
            Log.d(TAG, "handleManualNotificationAction skipped voice mode disabled " + describeNotification(notification));
            emitRuntimeError("Voice mode is off");
            return;
        }
        Log.d(
            TAG,
            "handleManualNotificationAction microphoneAction=" + microphoneAction
                + " " + describeNotification(notification)
        );
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "microphoneAction", microphoneAction);
        AssistantVoiceEventLog.put(details, "notification", describeNotification(notification));
        recordVoiceEvent("manual_notification_action", details);
        AssistantVoiceQueueItem item = microphoneAction
            ? notification.toManualMicQueueItem(config.autoListenEnabled)
            : notification.toManualSpeakerQueueItem(
                config.notificationTitlePlaybackEnabled,
                resolveNotificationSpokenTitle(notification)
            );
        if (item == null) {
            if (microphoneAction) {
                Log.d(TAG, "handleManualNotificationAction falling back to manual listen sessionId=" + notification.sessionId);
                startManualListen(notification.sessionId);
            } else {
                Log.d(TAG, "handleManualNotificationAction no speaker queue item " + describeNotification(notification));
            }
            return;
        }
        if (isManualPreemptStopInFlight()) {
            Log.d(TAG, "handleManualNotificationAction updating pending preempt item " + describeQueueItem(item));
            pendingManualPreemptQueueItem = item;
            return;
        }
        if (!activeTtsRequestId.isEmpty()) {
            Log.d(TAG, "handleManualNotificationAction deferring until current TTS stops");
            pendingManualPreemptQueueItem = item;
            stopCurrentInteraction(false, "manual_notification_preempt");
            return;
        }
        if (hasActiveInteraction()) {
            Log.d(TAG, "handleManualNotificationAction preempting active interaction");
            stopCurrentInteraction(false, "manual_notification_preempt");
        }
        enqueueQueueItem(item, true);
    }

    static boolean canHandleManualNotificationAction(
        AssistantVoiceNotificationRecord notification,
        boolean microphoneAction
    ) {
        if (notification == null) {
            return false;
        }
        return !microphoneAction || !notification.sessionId.isEmpty();
    }

    private void dismissDurableNotification(Intent intent) {
        String notificationId =
            intent == null ? "" : trim(intent.getStringExtra(EXTRA_NOTIFICATION_ID));
        if (notificationId.isEmpty()) {
            return;
        }
        durableNotifications.remove(notificationId);
        cancelDurableNotification(notificationId);
        removeQueuedItemsForNotification(notificationId);
        networkExecutor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("id", notificationId);
                postJson(AssistantVoiceUrlUtils.assistantNotificationClearUrl(config.assistantBaseUrl), body);
            } catch (Exception error) {
                Log.w(TAG, "Failed to clear dismissed durable notification", error);
            }
        });
    }

    private AssistantVoiceNotificationRecord notificationFromIntent(Intent intent) {
        if (intent == null) {
            return null;
        }
        Integer sessionActivitySeq =
            intent.hasExtra(EXTRA_NOTIFICATION_SESSION_ACTIVITY_SEQ)
                ? Integer.valueOf(intent.getIntExtra(EXTRA_NOTIFICATION_SESSION_ACTIVITY_SEQ, 0))
                : null;
        return new AssistantVoiceNotificationRecord(
            intent.getStringExtra(EXTRA_NOTIFICATION_ID),
            intent.getStringExtra(EXTRA_NOTIFICATION_KIND),
            intent.getStringExtra(EXTRA_NOTIFICATION_SOURCE),
            intent.getStringExtra(EXTRA_NOTIFICATION_TITLE),
            intent.getStringExtra(EXTRA_NOTIFICATION_BODY),
            "",
            intent.getStringExtra(EXTRA_NOTIFICATION_SESSION_ID),
            intent.getStringExtra(EXTRA_NOTIFICATION_SESSION_TITLE),
            intent.getStringExtra(EXTRA_NOTIFICATION_VOICE_MODE),
            intent.getStringExtra(EXTRA_NOTIFICATION_TTS_TEXT),
            intent.getStringExtra(EXTRA_NOTIFICATION_SOURCE_EVENT_ID),
            sessionActivitySeq
        );
    }

    private static int durableNotificationId(String notificationId) {
        return DURABLE_NOTIFICATION_ID_OFFSET + (trim(notificationId).hashCode() & 0x7FFFFFFF);
    }

    private static int durableNotificationRequestCode(String notificationId, int actionIndex) {
        int baseId = trim(notificationId).hashCode() & 0x7FFFFFFF;
        return DURABLE_NOTIFICATION_ID_OFFSET + baseId + Math.max(0, actionIndex);
    }

    private String postJson(String url, JSONObject body) throws IOException {
        Request request = new Request.Builder()
            .url(url)
            .post(RequestBody.create(body.toString(), JSON))
            .build();
        try (Response response = httpClient.newCall(request).execute()) {
            String responseText = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException(
                    "HTTP " + response.code()
                        + " url=" + safe(url)
                        + " body=" + abbreviateForLog(responseText)
                );
            }
            return responseText.isEmpty() ? "{}" : responseText;
        }
    }

    private void clearActivePromptContext() {
        activeVoiceSessionId = "";
        activePromptToolName = "";
    }

    private boolean hasActiveInteraction() {
        return !activeTtsRequestId.isEmpty() || !activeSttRequestId.isEmpty();
    }

    static boolean shouldUpdateStateAfterQueueAdvance(boolean hasActiveInteraction) {
        return !hasActiveInteraction;
    }

    private void updateStateIfNoActiveInteraction() {
        if (shouldUpdateStateAfterQueueAdvance(hasActiveInteraction())) {
            updateState(resolveInactiveState(), null);
        }
    }

    private String resolveInactiveState() {
        if (!config.isEnabled()) {
            return STATE_DISABLED;
        }
        return isRuntimeConnected() ? STATE_IDLE : STATE_CONNECTING;
    }

    private boolean isRuntimeConnected() {
        return adapterSocketConnected && assistantSocketConnected;
    }

    private boolean isPromptPlaybackActive() {
        return !activeTtsRequestId.isEmpty() || !pendingPlaybackDrainRequestId.isEmpty();
    }

    private boolean isManualPreemptStopInFlight() {
        return !pendingManualPreemptStopRequestId.isEmpty();
    }

    private void refreshNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(runtimeState));
        }
        syncMediaSession();
    }

    private void broadcastStateChanged() {
        Intent stateIntent = new Intent(BROADCAST_STATE_CHANGED);
        stateIntent.setPackage(getPackageName());
        stateIntent.putExtra(EXTRA_STATE, runtimeState);
        sendBroadcast(stateIntent);
    }

    private void syncRuntimeSnapshot(boolean broadcastState) {
        AssistantVoiceConfig.saveRuntimeSnapshot(
            this,
            runtimeState,
            null,
            activeVoiceSessionId,
            resolveActiveDisplayTitle()
        );
        refreshNotification();
        if (broadcastState) {
            broadcastStateChanged();
        }
    }

    private String resolveActiveDisplayTitle() {
        AssistantVoiceQueueItem item = activeQueueItem;
        if (item != null) {
            if (!item.displayTitle.isEmpty()) {
                return item.displayTitle;
            }
            if (!item.sessionTitle.isEmpty()) {
                return item.sessionTitle;
            }
        }
        if (!activeVoiceSessionId.isEmpty()) {
            return config.getSessionTitle(activeVoiceSessionId);
        }
        return "";
    }

    private void updateState(String nextState, String maybeErrorMessage) {
        String previousState = runtimeState;
        String normalizedState = trim(nextState);
        String normalizedError = trim(maybeErrorMessage);
        if (normalizedState.isEmpty()) {
            normalizedState = STATE_DISABLED;
        }
        if (runtimeState.equals(normalizedState) && normalizedError.isEmpty()) {
            return;
        }
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "previousState", safe(previousState));
        AssistantVoiceEventLog.put(details, "nextState", safe(normalizedState));
        AssistantVoiceEventLog.put(details, "error", safe(normalizedError));
        AssistantVoiceEventLog.put(details, "activeVoiceSessionId", safe(activeVoiceSessionId));
        AssistantVoiceEventLog.put(details, "selectedSessionId", safe(config.selectedSessionId));
        AssistantVoiceEventLog.put(details, "preferredVoiceSessionId", safe(config.preferredVoiceSessionId));
        AssistantVoiceEventLog.put(details, "activePromptToolName", safe(activePromptToolName));
        AssistantVoiceEventLog.put(details, "activeTtsRequestId", safe(activeTtsRequestId));
        AssistantVoiceEventLog.put(details, "activeSttRequestId", safe(activeSttRequestId));
        AssistantVoiceEventLog.put(details, "activeQueueItem", describeQueueItem(activeQueueItem));
        AssistantVoiceEventLog.put(details, "queueSize", queuedVoiceItems.size());
        recordVoiceEvent("state_transition", details);
        runtimeState = normalizedState;
        AssistantVoiceConfig.saveRuntimeSnapshot(
            this,
            normalizedState,
            normalizedError.isEmpty() ? null : normalizedError,
            activeVoiceSessionId,
            resolveActiveDisplayTitle()
        );
        refreshNotification();
        broadcastStateChanged();
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
        Log.w(TAG, "emitRuntimeError message=" + safe(message));
        AssistantVoiceConfig.saveRuntimeSnapshot(
            this,
            runtimeState,
            message,
            activeVoiceSessionId,
            resolveActiveDisplayTitle()
        );
        Intent errorIntent = new Intent(BROADCAST_RUNTIME_ERROR);
        errorIntent.setPackage(getPackageName());
        errorIntent.putExtra(EXTRA_MESSAGE, message);
        sendBroadcast(errorIntent);
    }

    private void recordVoiceEvent(String event, JSONObject details) {
        JSONObject payload = details == null ? AssistantVoiceEventLog.details() : details;
        AssistantVoiceEventLog.put(payload, "runtimeState", safe(runtimeState));
        AssistantVoiceEventLog.put(payload, "activeVoiceSessionId", safe(activeVoiceSessionId));
        AssistantVoiceEventLog.put(payload, "selectedSessionId", safe(config.selectedSessionId));
        AssistantVoiceEventLog.put(payload, "preferredVoiceSessionId", safe(config.preferredVoiceSessionId));
        AssistantVoiceEventLog.put(payload, "activePromptToolName", safe(activePromptToolName));
        AssistantVoiceEventLog.put(payload, "activeTtsRequestId", safe(activeTtsRequestId));
        AssistantVoiceEventLog.put(payload, "activeSttRequestId", safe(activeSttRequestId));
        AssistantVoiceEventLog.put(payload, "activeQueueItem", describeQueueItem(activeQueueItem));
        AssistantVoiceEventLog.put(payload, "queueSize", queuedVoiceItems.size());
        AssistantVoiceEventLog.record(this, event, payload);
    }

    private JSONObject eventDetailsWithNotification(Intent intent) {
        AssistantVoiceNotificationRecord notification = notificationFromIntent(intent);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "notification", describeNotification(notification));
        AssistantVoiceEventLog.put(
            details,
            "notificationId",
            safe(intent == null ? null : intent.getStringExtra(EXTRA_NOTIFICATION_ID))
        );
        return details;
    }

    static boolean shouldUsePositiveRecognitionCue(boolean success, String text) {
        return success && !trim(text).isEmpty();
    }

    static boolean shouldHandleRecognizedStopCommand(boolean success, String text) {
        return shouldHandleRecognizedStopCommand(success, text, true);
    }

    static boolean shouldHandleRecognizedStopCommand(
        boolean success,
        String text,
        boolean enabled
    ) {
        if (!enabled) {
            return false;
        }
        if (!success) {
            return false;
        }
        String normalized = trim(text).toLowerCase(java.util.Locale.US);
        if (normalized.isEmpty()) {
            return false;
        }
        String[] words = normalized.split("\\s+");
        if (words.length == 0 || words.length > 4) {
            return false;
        }
        for (String word : words) {
            String cleaned = word.replaceAll("^[^a-z0-9]+|[^a-z0-9]+$", "");
            if ("stop".equals(cleaned)) {
                return true;
            }
        }
        return false;
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
        pendingRecognitionCompletionCuePlaybackRequestId = "";
        pendingRecognitionCompletionPlaybackRequestId = "";
        pendingRecognitionCompletionCueSuccess = false;
        pendingRecognitionArmingCueRequestId = "";
        pendingRecognitionFailureRetrySessionId = "";
        stoppedRecognitionRequestId = "";
        recognitionReadyCuePlayed = false;
        recognitionCompletionCuePlayed = false;
    }

    private void queueRecognitionCompletionCue(String requestId, boolean success) {
        queueRecognitionCompletionCue(requestId, success, "");
    }

    private void queueRecognitionCompletionCue(
        String requestId,
        boolean success,
        String playbackRequestId
    ) {
        String normalizedRequestId = trim(requestId);
        pendingRecognitionCompletionCueRequestId = normalizedRequestId;
        pendingRecognitionCompletionCuePlaybackRequestId =
            buildRecognitionCompletionCueRequestId(normalizedRequestId);
        pendingRecognitionCompletionPlaybackRequestId = trim(playbackRequestId);
        pendingRecognitionCompletionCueSuccess = success;
    }

    private void playQueuedRecognitionCompletionCueIfNeeded(String requestId) {
        if (!shouldPlayQueuedRecognitionCompletionCue(pendingRecognitionCompletionCueRequestId, requestId)) {
            return;
        }
        boolean success = pendingRecognitionCompletionCueSuccess;
        String cuePlaybackRequestId = pendingRecognitionCompletionCuePlaybackRequestId;
        String playbackRequestId = pendingRecognitionCompletionPlaybackRequestId;
        pendingRecognitionCompletionCueRequestId = "";
        pendingRecognitionCompletionCueSuccess = false;
        playRecognitionCompletionCueIfNeeded(success, cuePlaybackRequestId, playbackRequestId);
    }

    private boolean scheduleQueuedRecognitionCompletionCueIfNeeded(String requestId) {
        if (!shouldPlayQueuedRecognitionCompletionCue(pendingRecognitionCompletionCueRequestId, requestId)) {
            return false;
        }
        boolean success = pendingRecognitionCompletionCueSuccess;
        String cuePlaybackRequestId = pendingRecognitionCompletionCuePlaybackRequestId;
        String playbackRequestId = pendingRecognitionCompletionPlaybackRequestId;
        pendingRecognitionCompletionCueRequestId = "";
        pendingRecognitionCompletionCueSuccess = false;
        mainHandler.postDelayed(
            () -> playRecognitionCompletionCueIfNeeded(
                success,
                cuePlaybackRequestId,
                playbackRequestId
            ),
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
        playRecognitionCompletionCueIfNeeded(success, "", "");
    }

    private void playRecognitionCompletionCueIfNeeded(boolean success, String playbackRequestId) {
        playRecognitionCompletionCueIfNeeded(success, "", playbackRequestId);
    }

    private void playRecognitionCompletionCueIfNeeded(
        boolean success,
        String cuePlaybackRequestId,
        String playbackRequestId
    ) {
        if (!config.recognitionCueEnabled || recognitionCompletionCuePlayed) {
            handleRecognitionCompletionCueFinished(cuePlaybackRequestId, playbackRequestId);
            return;
        }
        recognitionCompletionCuePlayed = true;
        playRecognitionCueWithRetry(
            cuePlaybackRequestId,
            success
                ? AssistantVoicePcmPlayer.RecognitionCueType.SUCCESS_COMPLETION
                : AssistantVoicePcmPlayer.RecognitionCueType.FAILURE_COMPLETION,
            0
        );
    }

    private void handleRecognitionCompletionCueFinished(
        String cuePlaybackRequestId,
        String playbackRequestId
    ) {
        String normalizedCuePlaybackRequestId = trim(cuePlaybackRequestId);
        if (!normalizedCuePlaybackRequestId.isEmpty()
            && normalizedCuePlaybackRequestId.equals(
                trim(pendingRecognitionCompletionCuePlaybackRequestId)
            )) {
            pendingRecognitionCompletionCuePlaybackRequestId = "";
        }
        String followupPlaybackRequestId = trim(playbackRequestId);
        if (followupPlaybackRequestId.isEmpty()) {
            followupPlaybackRequestId = trim(pendingRecognitionCompletionPlaybackRequestId);
        }
        pendingRecognitionCompletionPlaybackRequestId = "";
        if (!followupPlaybackRequestId.isEmpty()) {
            triggerRecognitionFailureRetryIfNeeded(followupPlaybackRequestId, false);
            return;
        }
        drainVoiceQueueIfPossible();
    }

    private void triggerRecognitionFailureRetryIfNeeded(
        String playbackRequestId,
        boolean cuePlaybackRequested
    ) {
        String retrySessionId = extractRecognitionFailureRetrySessionId(playbackRequestId);
        if (retrySessionId.isEmpty()) {
            return;
        }
        pendingRecognitionFailureRetrySessionId = retrySessionId;
        if (!cuePlaybackRequested) {
            mainHandler.post(() -> {
                if (!retrySessionId.equals(trim(pendingRecognitionFailureRetrySessionId))) {
                    return;
                }
                pendingRecognitionFailureRetrySessionId = "";
                JSONObject details = AssistantVoiceEventLog.details();
                AssistantVoiceEventLog.put(details, "sessionId", safe(retrySessionId));
                recordVoiceEvent("recognition_retry_start", details);
                startRecognition(retrySessionId, "empty_transcript_retry");
            });
            return;
        }
        mainHandler.postDelayed(
            () -> {
                if (!retrySessionId.equals(trim(pendingRecognitionFailureRetrySessionId))) {
                    return;
                }
                pendingRecognitionFailureRetrySessionId = "";
                JSONObject details = AssistantVoiceEventLog.details();
                AssistantVoiceEventLog.put(details, "requestId", safe(playbackRequestId));
                AssistantVoiceEventLog.put(details, "sessionId", safe(retrySessionId));
                recordVoiceEvent("recognition_retry_fallback_start", details);
                startRecognition(retrySessionId, "empty_transcript_retry");
            },
            RECOGNITION_FAILURE_RETRY_FALLBACK_DELAY_MS
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

    static String buildRecognitionCompletionCueRequestId(String requestId) {
        String normalized = trim(requestId);
        return normalized.isEmpty()
            ? ""
            : RECOGNITION_COMPLETION_CUE_REQUEST_PREFIX + normalized;
    }

    static String extractRecognitionArmingCueRequestId(String playbackRequestId) {
        String normalized = trim(playbackRequestId);
        if (!normalized.startsWith(RECOGNITION_ARMING_CUE_REQUEST_PREFIX)) {
            return "";
        }
        return trim(normalized.substring(RECOGNITION_ARMING_CUE_REQUEST_PREFIX.length()));
    }

    static String extractRecognitionCompletionCueRequestId(String playbackRequestId) {
        String normalized = trim(playbackRequestId);
        if (!normalized.startsWith(RECOGNITION_COMPLETION_CUE_REQUEST_PREFIX)) {
            return "";
        }
        return trim(normalized.substring(RECOGNITION_COMPLETION_CUE_REQUEST_PREFIX.length()));
    }

    static String buildRecognitionFailureRetryCueRequestId(String sessionId) {
        String normalized = trim(sessionId);
        return normalized.isEmpty() ? "" : RECOGNITION_FAILURE_RETRY_CUE_REQUEST_PREFIX + normalized;
    }

    static String extractRecognitionFailureRetrySessionId(String playbackRequestId) {
        String normalized = trim(playbackRequestId);
        if (!normalized.startsWith(RECOGNITION_FAILURE_RETRY_CUE_REQUEST_PREFIX)) {
            return "";
        }
        return trim(normalized.substring(RECOGNITION_FAILURE_RETRY_CUE_REQUEST_PREFIX.length()));
    }

    static boolean shouldStartRecognitionAfterArmingCue(
        String pendingRecognitionRequestId,
        String playbackRequestId
    ) {
        return trim(pendingRecognitionRequestId).equals(
            extractRecognitionArmingCueRequestId(playbackRequestId)
        );
    }

    static boolean shouldRetryRecognitionAfterEmptyTranscript(
        boolean success,
        boolean canceled,
        String error,
        String sessionId
    ) {
        return !success
            && !canceled
            && "empty_transcript".equals(trim(error))
            && !trim(sessionId).isEmpty();
    }

    static boolean shouldBlockQueueDuringRecognitionSubmit(
        String audioMode,
        String sessionId,
        boolean submitSucceeded
    ) {
        return submitSucceeded
            && AssistantVoiceConfig.AUDIO_MODE_RESPONSE.equals(trim(audioMode))
            && !trim(sessionId).isEmpty();
    }

    static boolean shouldUsePlaybackDrainTimeoutFallback(
        String pendingPlaybackDrainRequestId,
        String activeTtsRequestId,
        String requestId
    ) {
        String normalizedRequestId = trim(requestId);
        return !normalizedRequestId.isEmpty()
            && trim(activeTtsRequestId).isEmpty()
            && normalizedRequestId.equals(trim(pendingPlaybackDrainRequestId));
    }

    private String explainQueueDrainBlock() {
        if (destroyed) {
            return "destroyed";
        }
        if (!pendingRecognitionSubmitSessionId.isEmpty()) {
            return "pending_recognition_submit";
        }
        if (!pendingRecognitionCompletionCueRequestId.isEmpty()
            || !pendingRecognitionCompletionCuePlaybackRequestId.isEmpty()) {
            return "pending_recognition_completion_cue";
        }
        if (isManualPreemptStopInFlight()) {
            return "manual_preempt_stop_in_flight";
        }
        if (hasActiveInteraction()) {
            return "active_interaction";
        }
        if (activeQueueItem != null) {
            return "active_queue_item";
        }
        if (queuedVoiceItems.isEmpty()) {
            return "queue_empty";
        }
        if (!config.isEnabled()) {
            return "voice_mode_disabled";
        }
        if (!isRuntimeConnected()) {
            return "runtime_not_connected";
        }
        return "";
    }

    private String describeRuntimeState() {
        return "state=" + safe(runtimeState)
            + " adapterSocketConnected=" + adapterSocketConnected
            + " assistantSocketConnected=" + assistantSocketConnected
            + " activeTtsRequestId=" + safe(activeTtsRequestId)
            + " pendingManualPreemptStopRequestId=" + safe(pendingManualPreemptStopRequestId)
            + " activeSttRequestId=" + safe(activeSttRequestId)
            + " activeQueueItem=" + describeQueueItem(activeQueueItem)
            + " queueSize=" + queuedVoiceItems.size();
    }

    private static String describeQueueItem(AssistantVoiceQueueItem item) {
        if (item == null) {
            return "<null>";
        }
        return "notificationId=" + safe(item.notificationId)
            + " sessionId=" + safe(item.sessionId)
            + " executionMode=" + safe(item.executionMode)
            + " manual=" + item.manual
            + " hasSpeech=" + item.hasSpeech()
            + " startsListening=" + item.startsListeningAfterPlayback()
            + " sessionAttention=" + item.isSessionAttention()
            + " sessionActivitySeq=" + item.sessionActivitySeq;
    }

    private void enqueuePendingManualPreemptQueueItem(String reason) {
        AssistantVoiceQueueItem item = pendingManualPreemptQueueItem;
        pendingManualPreemptQueueItem = null;
        if (item == null) {
            Log.d(TAG, "enqueuePendingManualPreemptQueueItem skipped reason=" + reason);
            return;
        }
        Log.d(TAG, "enqueuePendingManualPreemptQueueItem reason=" + reason + " " + describeQueueItem(item));
        enqueueQueueItem(item, true);
    }

    private void clearPendingManualPreemptState(String reason) {
        if (pendingManualPreemptStopRequestId.isEmpty() && pendingManualPreemptQueueItem == null) {
            return;
        }
        Log.d(
            TAG,
            "clearPendingManualPreemptState reason=" + reason
                + " requestId=" + safe(pendingManualPreemptStopRequestId)
                + " item=" + describeQueueItem(pendingManualPreemptQueueItem)
        );
        pendingManualPreemptStopRequestId = "";
        pendingManualPreemptQueueItem = null;
    }

    private void beginPendingRecognitionSubmit(String sessionId) {
        String normalizedSessionId = trim(sessionId);
        if (normalizedSessionId.isEmpty()) {
            return;
        }
        pendingRecognitionSubmitSessionId = normalizedSessionId;
        mainHandler.removeCallbacks(clearPendingRecognitionSubmitRunnable);
        mainHandler.postDelayed(
            clearPendingRecognitionSubmitRunnable,
            RECOGNITION_SUBMIT_TIMEOUT_MS
        );
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", safe(normalizedSessionId));
        recordVoiceEvent("recognition_submit_pending", details);
    }

    private void clearPendingRecognitionSubmit(String reason, boolean drainQueue) {
        String normalizedSessionId = trim(pendingRecognitionSubmitSessionId);
        if (normalizedSessionId.isEmpty()) {
            return;
        }
        pendingRecognitionSubmitSessionId = "";
        mainHandler.removeCallbacks(clearPendingRecognitionSubmitRunnable);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "reason", safe(reason));
        AssistantVoiceEventLog.put(details, "sessionId", safe(normalizedSessionId));
        recordVoiceEvent("recognition_submit_cleared", details);
        if (drainQueue) {
            drainVoiceQueueIfPossible();
        }
    }

    private void schedulePlaybackDrainTimeout(String requestId, int audioBytes, int sampleRate) {
        String normalizedRequestId = trim(requestId);
        if (normalizedRequestId.isEmpty()) {
            return;
        }
        pendingPlaybackDrainTimeoutRequestId = normalizedRequestId;
        mainHandler.removeCallbacks(playbackDrainTimeoutRunnable);
        mainHandler.postDelayed(
            playbackDrainTimeoutRunnable,
            resolvePlaybackDrainTimeoutMs(audioBytes, sampleRate)
        );
    }

    static long resolvePlaybackDrainTimeoutMs(int audioBytes, int sampleRate) {
        int normalizedBytes = Math.max(0, audioBytes);
        int normalizedSampleRate = Math.max(0, sampleRate);
        if (normalizedBytes <= 0 || normalizedSampleRate <= 0) {
            return PLAYBACK_DRAIN_TIMEOUT_MS;
        }
        long bytesPerSecond = normalizedSampleRate * 2L;
        if (bytesPerSecond <= 0L) {
            return PLAYBACK_DRAIN_TIMEOUT_MS;
        }
        long estimatedPlaybackMs = (normalizedBytes * 1000L) / bytesPerSecond;
        long timeoutMs = estimatedPlaybackMs + PLAYBACK_DRAIN_TIMEOUT_MARGIN_MS;
        return Math.max(PLAYBACK_DRAIN_TIMEOUT_MS, timeoutMs);
    }

    private void clearPlaybackDrainTimeout(String requestId) {
        String normalizedRequestId = trim(requestId);
        if (!normalizedRequestId.isEmpty()
            && !normalizedRequestId.equals(trim(pendingPlaybackDrainTimeoutRequestId))) {
            return;
        }
        pendingPlaybackDrainTimeoutRequestId = "";
        mainHandler.removeCallbacks(playbackDrainTimeoutRunnable);
    }

    private void handlePlaybackDrainTimeout() {
        String requestId = trim(pendingPlaybackDrainTimeoutRequestId);
        if (!shouldUsePlaybackDrainTimeoutFallback(
            pendingPlaybackDrainRequestId,
            activeTtsRequestId,
            requestId
        )) {
            return;
        }
        pendingPlaybackDrainTimeoutRequestId = "";
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "requestId", safe(requestId));
        AssistantVoiceEventLog.put(details, "pendingPlaybackDrainRequestId", safe(pendingPlaybackDrainRequestId));
        AssistantVoiceEventLog.put(details, "textLength", activeTtsTextLength);
        AssistantVoiceEventLog.put(details, "sampleRate", activeTtsSampleRate);
        AssistantVoiceEventLog.put(details, "audioChunkCount", activeTtsAudioChunkCount);
        AssistantVoiceEventLog.put(details, "audioBytes", activeTtsAudioBytes);
        recordVoiceEvent("playback_drain_timeout", details);
        handlePlaybackDrained(requestId);
    }

    private static int estimateBase64DecodedBytes(String value) {
        String normalized = trim(value);
        if (normalized.isEmpty()) {
            return 0;
        }
        try {
            return Base64.decode(normalized, Base64.DEFAULT).length;
        } catch (IllegalArgumentException error) {
            return 0;
        }
    }

    private static String describeNotification(AssistantVoiceNotificationRecord notification) {
        if (notification == null) {
            return "<null>";
        }
        return "notificationId=" + safe(notification.id)
            + " sessionId=" + safe(notification.sessionId)
            + " kind=" + safe(notification.kind)
            + " voiceMode=" + safe(notification.voiceMode)
            + " unread=" + notification.isUnread()
            + " hasSpeech=" + !notification.resolveSpokenText(false).isEmpty()
            + " sessionActivitySeq=" + notification.sessionActivitySeq;
    }

    private static String safe(String value) {
        String normalized = trim(value);
        return normalized.isEmpty() ? "<empty>" : normalized;
    }

    private static String abbreviateForLog(String value) {
        String normalized = trim(value);
        if (normalized.length() <= 200) {
            return safe(normalized);
        }
        return normalized.substring(0, 200) + "...";
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
