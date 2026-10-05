package com.assistant.mobile.voice;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONObject;

import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "AssistantNativeVoice",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public final class AssistantVoicePlugin extends Plugin {
    private static final String TAG = "AssistantVoicePlugin";
    private static final String PENDING_ACTION_SET_VOICE_SETTINGS = "set_voice_settings";
    private static final String PENDING_ACTION_START_LISTEN = "start_manual_listen";
    private static final String PENDING_ACTION_NOTIFICATION_MIC = "notification_mic";

    private final Object credentialStateLock = new Object();
    private final ExecutorService credentialWorker = Executors.newSingleThreadExecutor();
    private final CopyOnWriteArrayList<AssistantSpeechClient> credentialClients = new CopyOnWriteArrayList<>();
    private AssistantSpeechCredentialDialog credentialDialog;
    private PluginCall credentialCall;
    private volatile AssistantSpeechClient dialogTestClient;
    private volatile long credentialDialogEpoch;
    private volatile boolean destroyed;

    private BroadcastReceiver receiver;
    private String pendingPermissionAction = "";
    private AssistantVoiceConfig pendingVoiceSettings = null;

    @Override
    public void load() {
        super.load();
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) {
                    return;
                }
                if (AssistantVoiceRuntimeService.BROADCAST_STATE_CHANGED.equals(intent.getAction())) {
                    notifyListeners("stateChanged", buildStatePayload(), true);
                    return;
                }
                if (
                    AssistantVoiceRuntimeService.BROADCAST_VOICE_SETTINGS_CHANGED.equals(
                        intent.getAction()
                    )
                ) {
                    notifyListeners("voiceSettingsChanged", buildStatePayload(), true);
                    return;
                }
                if (AssistantVoiceRuntimeService.BROADCAST_RUNTIME_ERROR.equals(intent.getAction())) {
                    String message = intent.getStringExtra(AssistantVoiceRuntimeService.EXTRA_MESSAGE);
                    if (message == null || message.trim().isEmpty()) {
                        return;
                    }
                    JSObject error = new JSObject();
                    error.put("message", message);
                    notifyListeners("runtimeError", error);
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(AssistantVoiceRuntimeService.BROADCAST_STATE_CHANGED);
        filter.addAction(AssistantVoiceRuntimeService.BROADCAST_VOICE_SETTINGS_CHANGED);
        filter.addAction(AssistantVoiceRuntimeService.BROADCAST_RUNTIME_ERROR);
        ContextCompat.registerReceiver(
            getContext(),
            receiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        );

        notifyListeners("stateChanged", buildStatePayload(), true);

        checkLaunchIntentForOpenSession();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        checkIntentForOpenSession(intent);
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        for (AssistantSpeechClient client : credentialClients) client.close();
        credentialClients.clear();
        credentialWorker.shutdownNow();
        if (credentialDialog != null) credentialDialog.dismiss();
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
            }
            receiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void startRealtime(PluginCall call) {
        Context context = getContext();
        context.startForegroundService(AssistantVoiceRuntimeService.startRealtimeIntent(context));
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void stopRealtime(PluginCall call) {
        Context context = getContext();
        context.startService(AssistantVoiceRuntimeService.stopRealtimeIntent(context));
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setRealtimeMuted(PluginCall call) {
        boolean muted = call.getBoolean("muted", false);
        Context context = getContext();
        context.startService(AssistantVoiceRuntimeService.setRealtimeMutedIntent(context, muted));
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setVoiceSettings(PluginCall call) {
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        final AssistantVoiceConfig updated;
        try { updated = extractVoiceSettingsConfig(call, current); }
        catch (IllegalArgumentException invalid) {
            call.reject("Speech API root must be an HTTP or HTTPS URL without embedded credentials, query, or fragment.");
            return;
        }
        if (updated == null) {
            call.reject("settings is required");
            return;
        }

        try { AssistantSpeechCredentialStore.normalizeEndpoint(updated.speechServerBaseUrl); }
        catch (IllegalArgumentException invalid) {
            call.reject("Speech API root must be an HTTP or HTTPS URL without embedded credentials, query, or fragment.");
            return;
        }

        if (updated.isEnabled() && !hasVoiceModePermissions()) {
            pendingPermissionAction = PENDING_ACTION_SET_VOICE_SETTINGS;
            pendingVoiceSettings = updated;
            saveCall(call);
            requestVoiceModePermissions(call);
            return;
        }

        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setSelectedSession(PluginCall call) {
        JSONObject selection = call.getData().optJSONObject("selection");
        String panelId = selection == null
            ? call.getString(AssistantVoiceConfig.EXTRA_SELECTED_PANEL_ID)
            : selection.optString("panelId", null);
        String sessionId = selection == null
            ? call.getString(AssistantVoiceConfig.EXTRA_SELECTED_SESSION_ID)
            : selection.optString("sessionId", null);

        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withSelection(panelId, sessionId);
        applyConfig(updated);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "panelId", safe(panelId));
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.record(getContext(), "plugin_set_selected_session", details);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setSessionTitles(PluginCall call) {
        JSONObject sessionTitles = call.getData().optJSONObject(AssistantVoiceConfig.EXTRA_SESSION_TITLES);
        if (sessionTitles == null) {
            call.reject("sessionTitles is required");
            return;
        }
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withSessionTitles(sessionTitles);
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setInputContext(PluginCall call) {
        JSONObject inputContext = call.getData().optJSONObject("inputContext");
        if (inputContext == null) {
            call.reject("inputContext is required");
            return;
        }
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withInputContext(
            inputContext.optBoolean("enabled", current.inputContextEnabled),
            inputContext.optString("contextLine", current.inputContextLine)
        );
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setAssistantBaseUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            url = call.getString(AssistantVoiceConfig.EXTRA_ASSISTANT_BASE_URL);
        }
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withAssistantBaseUrl(url);
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void skipCurrentPlayback(PluginCall call) {
        AssistantVoiceEventLog.record(getContext(), "plugin_skip_current_playback");
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.skipCurrentPlaybackIntent(getContext())
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void stopCurrentInteraction(PluginCall call) {
        AssistantVoiceEventLog.record(getContext(), "plugin_stop_current_interaction");
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.stopCurrentInteractionIntent(getContext())
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void startManualListen(PluginCall call) {
        String sessionId = call.getString("sessionId");
        Log.d(TAG, "startManualListen invoked sessionId=" + safe(sessionId));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.record(getContext(), "plugin_start_manual_listen", details);
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingPermissionAction = PENDING_ACTION_START_LISTEN;
            saveCall(call);
            Log.d(TAG, "startManualListen awaiting microphone permission sessionId=" + safe(sessionId));
            AssistantVoiceEventLog.record(
                getContext(),
                "plugin_start_manual_listen_permission_pending",
                details
            );
            requestPermissionForAlias("microphone", call, "handleMicrophonePermissionResult");
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.startManualListenIntent(getContext(), sessionId)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void retargetActiveRecognition(PluginCall call) {
        String sessionId = call.getString("sessionId");
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.record(getContext(), "plugin_retarget_active_recognition", details);
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.retargetActiveRecognitionIntent(getContext(), sessionId)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void playText(PluginCall call) {
        String text = trim(call.getString("text"));
        if (text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        String sessionId = call.getString("sessionId");
        String title = call.getString("title");
        String sourceEventId = call.getString("sourceEventId");
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.put(details, "sourceEventId", safe(sourceEventId));
        AssistantVoiceEventLog.put(details, "textLength", text.length());
        AssistantVoiceEventLog.record(getContext(), "plugin_play_text", details);
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.playTextIntent(
                getContext(),
                sessionId,
                text,
                title,
                sourceEventId
            )
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void performNotificationSpeaker(PluginCall call) {
        AssistantVoiceNotificationRecord notification = extractNotification(call);
        if (notification == null) {
            Log.w(TAG, "performNotificationSpeaker missing notification payload");
            call.reject("notification is required");
            return;
        }
        Log.d(TAG, "performNotificationSpeaker invoked " + describeNotification(notification));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "notification", describeNotification(notification));
        AssistantVoiceEventLog.record(getContext(), "plugin_notification_play", details);
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.notificationSpeakerIntent(getContext(), notification)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void performNotificationMic(PluginCall call) {
        AssistantVoiceNotificationRecord notification = extractNotification(call);
        if (notification == null) {
            Log.w(TAG, "performNotificationMic missing notification payload");
            call.reject("notification is required");
            return;
        }
        Log.d(TAG, "performNotificationMic invoked " + describeNotification(notification));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "notification", describeNotification(notification));
        AssistantVoiceEventLog.record(getContext(), "plugin_notification_speak", details);
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        if (!current.allowsNotificationSpeak()) {
            Log.d(TAG, "performNotificationMic rejected: speak not allowed in " + current.audioMode);
            call.reject("Speak is not available in this audio mode");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingPermissionAction = PENDING_ACTION_NOTIFICATION_MIC;
            saveCall(call);
            Log.d(TAG, "performNotificationMic awaiting microphone permission " + describeNotification(notification));
            AssistantVoiceEventLog.record(
                getContext(),
                "plugin_notification_speak_permission_pending",
                details
            );
            requestPermissionForAlias("microphone", call, "handleMicrophonePermissionResult");
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.notificationMicIntent(getContext(), notification)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void listInputDevices(PluginCall call) {
        Log.d(TAG, "listInputDevices invoked");
        JSArray devices = new JSArray();
        for (AssistantVoiceAudioDeviceUtils.InputDeviceOption option : AssistantVoiceAudioDeviceUtils.listInputDevices(getContext())) {
            JSObject entry = new JSObject();
            entry.put("id", option.id);
            entry.put("label", option.label);
            devices.put(entry);
        }
        Log.d(TAG, "listInputDevices resolved count=" + devices.length() + " payload=" + devices);
        JSObject payload = new JSObject();
        payload.put("devices", devices);
        call.resolve(payload);
    }

    @PluginMethod
    public void manageSpeechCredential(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || destroyed) {
            call.reject("Speech token management requires an active Android screen.");
            return;
        }
        AssistantVoiceConfig snapshot = AssistantVoiceConfig.load(getContext());
        final String endpoint;
        try { endpoint = AssistantSpeechCredentialStore.normalizeEndpoint(snapshot.speechServerBaseUrl); }
        catch (IllegalArgumentException error) { call.reject("Save a valid speech server API root first."); return; }
        credentialWorker.execute(() -> {
            final boolean configured;
            try { configured = new AssistantSpeechCredentialStore(getContext()).isConfigured(endpoint); }
            catch (Exception error) { call.reject("Saved speech token is unavailable. Remove it and save it again."); return; }
            activity.runOnUiThread(() -> {
                if (destroyed || activity.isFinishing() || !speechConnectionMatches(snapshot)) {
                    call.reject("Speech settings changed. Open token management again.");
                    return;
                }
                if (credentialDialog != null) {
                    call.reject("Speech token management is already open.");
                    return;
                }
                credentialCall = call;
                final long dialogEpoch = ++credentialDialogEpoch;
                credentialDialog = new AssistantSpeechCredentialDialog(activity, endpoint, configured,
                    (action, secret, reply) -> credentialWorker.execute(() -> performCredentialAction(snapshot, endpoint, action, secret, dialogEpoch, reply)),
                    () -> {
                        synchronized (credentialStateLock) {
                            ++credentialDialogEpoch;
                            if (dialogTestClient != null) {
                                dialogTestClient.close();
                                credentialClients.remove(dialogTestClient);
                                dialogTestClient = null;
                            }
                        }
                        credentialDialog = null;
                        PluginCall pending = credentialCall;
                        credentialCall = null;
                        if (pending != null) resolveCredentialStatus(pending);
                    });
                credentialDialog.show();
            });
        });
    }

    @PluginMethod
    public void discoverSpeechModels(PluginCall call) {
        AssistantVoiceConfig snapshot = AssistantVoiceConfig.load(getContext());
        credentialWorker.execute(() -> {
            try {
                String token = new AssistantSpeechCredentialStore(getContext()).get(snapshot.speechServerBaseUrl);
                if (token == null) { resolveSpeechDiscovery(call, null, false, "Save a speech server token on this device first."); return; }
                discoverForCredential(snapshot, token, new AssistantSpeechClient.DiscoveryListener() {
                    @Override public void ready(JSONObject catalog) { resolveSpeechDiscovery(call, catalog, true, null); }
                    @Override public void failed(String message) { resolveSpeechDiscovery(call, null, true, message); }
                });
            } catch (Exception error) {
                resolveSpeechDiscovery(call, null, false, "Speech endpoint or saved token is unavailable. Check the API root and manage the token.");
            }
        });
    }

    private void performCredentialAction(AssistantVoiceConfig snapshot, String endpoint, String action,
        String entered, long dialogEpoch, AssistantSpeechCredentialDialog.Reply reply) {
        try {
            final boolean configured;
            final String token;
            synchronized (credentialStateLock) {
                if (destroyed || credentialDialogEpoch != dialogEpoch || !speechConnectionMatches(snapshot)) {
                    reply.failed("Speech settings changed. Close and reopen token management.", true);
                    return;
                }
                AssistantSpeechCredentialStore store = new AssistantSpeechCredentialStore(getContext());
                if (action.equals("save")) {
                    AssistantSpeechCredentialStore.validateToken(entered);
                    store.set(endpoint, entered);
                    applyConfig(AssistantVoiceConfig.load(getContext()), true);
                    reply.done(true);
                    return;
                }
                if (action.equals("remove")) {
                    store.remove(endpoint);
                    applyConfig(AssistantVoiceConfig.load(getContext()), true);
                    reply.done(false);
                    return;
                }
                configured = store.isConfigured(endpoint);
                token = entered == null ? store.get(endpoint) : entered;
                if (token == null) { reply.failed("Enter a token to test access.", false); return; }
                AssistantSpeechCredentialStore.validateToken(token);
            }
            AssistantSpeechClient testClient = discoverForCredential(snapshot, token, new AssistantSpeechClient.DiscoveryListener() {
                @Override public void ready(JSONObject catalog) { reply.done(configured); }
                @Override public void failed(String message) { reply.failed(message, !speechConnectionMatches(snapshot)); }
            });
            synchronized (credentialStateLock) {
                if (credentialDialogEpoch == dialogEpoch && !destroyed) dialogTestClient = testClient;
                else if (testClient != null) {
                    testClient.close();
                    credentialClients.remove(testClient);
                }
            }
        } catch (IllegalArgumentException error) {
            reply.failed("Enter a valid bearer token without whitespace and save a valid API root.", false);
        } catch (Exception error) {
            reply.failed("Speech token storage is unavailable. Remove the saved token and try again.", false);
        }
    }

    private AssistantSpeechClient discoverForCredential(AssistantVoiceConfig snapshot, String token, AssistantSpeechClient.DiscoveryListener listener) {
        if (destroyed || !speechConnectionMatches(snapshot)) {
            listener.failed("Speech settings changed. Retry for the current API root.");
            return null;
        }
        AssistantSpeechClient client = new AssistantSpeechClient(snapshot.speechServerBaseUrl, token,
            snapshot.speechRecognitionModel, snapshot.speechSynthesisModel, snapshot.speechVoice);
        credentialClients.add(client);
        client.discover(new AssistantSpeechClient.DiscoveryListener() {
            @Override public void ready(JSONObject catalog) {
                credentialClients.remove(client);
                client.close();
                if (!destroyed && speechConnectionMatches(snapshot)) listener.ready(catalog);
                else listener.failed("Speech settings changed. Retry for the current API root.");
            }
            @Override public void failed(String message) {
                credentialClients.remove(client);
                client.close();
                if (!destroyed && speechConnectionMatches(snapshot)) listener.failed(speechDiscoveryError(message));
                else listener.failed("Speech settings changed. Retry for the current API root.");
            }
        });
        return client;
    }

    private static String speechDiscoveryError(String code) {
        if ("speech_authentication_failed".equals(code)) return "The speech server rejected the token. Check and save the bearer token again.";
        if ("speech_server_configuration_unsupported".equals(code) || "speech_discovery_invalid".equals(code))
            return "The speech API root does not advertise a supported model catalog. Check the API root and server version.";
        if ("speech_rate_limited".equals(code)) return "The speech server is busy. Try again shortly.";
        if ("speech_discovery_timeout".equals(code)) return "The speech server did not respond in time. Check connectivity and try again.";
        return "The speech server could not be reached. Check the API root and network connection.";
    }

    private boolean speechConnectionMatches(AssistantVoiceConfig snapshot) {
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        return snapshot.assistantBaseUrl.equals(current.assistantBaseUrl)
            && snapshot.speechServerBaseUrl.equals(current.speechServerBaseUrl)
            && snapshot.speechRecognitionModel.equals(current.speechRecognitionModel)
            && snapshot.speechSynthesisModel.equals(current.speechSynthesisModel)
            && snapshot.speechVoice.equals(current.speechVoice);
    }

    private void resolveCredentialStatus(PluginCall call) {
        JSObject payload = new JSObject();
        try {
            AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
            payload.put("credentialConfigured", new AssistantSpeechCredentialStore(getContext()).isConfigured(current.speechServerBaseUrl));
        } catch (Exception error) {
            payload.put("credentialConfigured", false);
            payload.put("error", "Saved speech token is unavailable. Check the API root and manage the token.");
        }
        call.resolve(payload);
    }

    private void resolveSpeechDiscovery(PluginCall call, JSONObject catalog, boolean configured, String error) {
        JSObject payload = new JSObject();
        payload.put("credentialConfigured", configured);
        if (catalog != null) payload.put("catalog", catalog);
        if (error != null) payload.put("error", error);
        call.resolve(payload);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(buildStatePayload());
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void handleVoiceModePermissionResult(PluginCall call) {
        PluginCall savedCall = getSavedCall();
        if (savedCall == null) {
            if (call != null) {
                call.reject("Permission callback lost");
            }
            return;
        }
        if (!hasVoiceModePermissions()) {
            pendingPermissionAction = "";
            pendingVoiceSettings = null;
            AssistantVoiceEventLog.record(
                getContext(),
                "plugin_voice_mode_permission_denied"
            );
            savedCall.reject("Microphone and notification permissions are required");
            bridge.releaseCall(savedCall);
            return;
        }

        if (PENDING_ACTION_SET_VOICE_SETTINGS.equals(pendingPermissionAction) && pendingVoiceSettings != null) {
            applyConfig(pendingVoiceSettings);
        }

        pendingPermissionAction = "";
        pendingVoiceSettings = null;
        AssistantVoiceEventLog.record(getContext(), "plugin_voice_mode_permission_granted");
        savedCall.resolve(buildStatePayload());
        bridge.releaseCall(savedCall);
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void handleMicrophonePermissionResult(PluginCall call) {
        PluginCall savedCall = getSavedCall();
        if (savedCall == null) {
            if (call != null) {
                call.reject("Permission callback lost");
            }
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            Log.w(TAG, "handleMicrophonePermissionResult denied pendingAction=" + pendingPermissionAction);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "pendingAction", pendingPermissionAction);
            AssistantVoiceEventLog.record(getContext(), "plugin_microphone_permission_denied", details);
            pendingPermissionAction = "";
            pendingVoiceSettings = null;
            savedCall.reject("Microphone permission is required");
            bridge.releaseCall(savedCall);
            return;
        }

        Log.d(TAG, "handleMicrophonePermissionResult granted pendingAction=" + pendingPermissionAction);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "pendingAction", pendingPermissionAction);
        AssistantVoiceEventLog.record(getContext(), "plugin_microphone_permission_granted", details);
        if (PENDING_ACTION_SET_VOICE_SETTINGS.equals(pendingPermissionAction) && pendingVoiceSettings != null) {
            applyConfig(pendingVoiceSettings);
        } else if (PENDING_ACTION_START_LISTEN.equals(pendingPermissionAction)) {
            String sessionId = savedCall.getString("sessionId");
            Log.d(TAG, "resuming startManualListen after permission sessionId=" + safe(sessionId));
            ContextCompat.startForegroundService(
                getContext(),
                AssistantVoiceRuntimeService.startManualListenIntent(getContext(), sessionId)
            );
        } else if (PENDING_ACTION_NOTIFICATION_MIC.equals(pendingPermissionAction)) {
            AssistantVoiceNotificationRecord notification = extractNotification(savedCall);
            if (notification != null) {
                Log.d(TAG, "resuming performNotificationMic after permission " + describeNotification(notification));
                ContextCompat.startForegroundService(
                    getContext(),
                    AssistantVoiceRuntimeService.notificationMicIntent(getContext(), notification)
                );
            } else {
                Log.w(TAG, "notification mic permission resumed without notification payload");
            }
        }

        pendingPermissionAction = "";
        pendingVoiceSettings = null;
        savedCall.resolve(buildStatePayload());
        bridge.releaseCall(savedCall);
    }

    private void applyConfig(AssistantVoiceConfig config) {
        applyConfig(config, false);
    }

    private void applyConfig(AssistantVoiceConfig config, boolean credentialChanged) {
        synchronized (credentialStateLock) {
            AssistantVoiceConfig.save(getContext(), config);
        }
        if (!config.isEnabled()) {
            getContext().stopService(AssistantVoiceRuntimeService.stopServiceIntent(getContext()));
            AssistantVoiceConfig.saveRuntimeSnapshot(
                getContext(),
                AssistantVoiceRuntimeService.STATE_DISABLED,
                null,
                null,
                null
            );
            notifyListeners("stateChanged", buildStatePayload(), true);
            return;
        }

        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.applyConfigIntent(getContext(), config, credentialChanged)
        );
    }

    private JSObject buildStatePayload() {
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        JSObject selection = new JSObject();
        if (!current.selectedPanelId.isEmpty()) {
            selection.put("panelId", current.selectedPanelId);
        }
        if (!current.selectedSessionId.isEmpty()) {
            selection.put("sessionId", current.selectedSessionId);
        }
        JSObject inputContext = new JSObject();
        inputContext.put("enabled", current.inputContextEnabled);
        inputContext.put("contextLine", current.inputContextLine);

        JSObject voiceSettings = new JSObject();
        voiceSettings.put("voiceRuntimeMode", current.voiceRuntimeMode);
        voiceSettings.put("realtimeConversationId", current.realtimeConversationId);
        voiceSettings.put("realtimeMuteOnStart", current.realtimeMuteOnStart);
        voiceSettings.put("realtimeSpeakerphone", current.realtimeSpeakerphone);
        voiceSettings.put("realtimeListsInstanceId", current.realtimeListsInstanceId);
        voiceSettings.put("audioMode", current.audioMode);
        voiceSettings.put("autoListenEnabled", current.autoListenEnabled);
        voiceSettings.put("mediaButtonsEnabled", current.mediaButtonsEnabled);
        voiceSettings.put(
            "localResponseVoiceOnlyEnabled",
            current.localResponseVoiceOnlyEnabled
        );
        voiceSettings.put("speechServerBaseUrl", current.speechServerBaseUrl);
        voiceSettings.put("speechRecognitionModel", current.speechRecognitionModel);
        voiceSettings.put("speechSynthesisModel", current.speechSynthesisModel);
        voiceSettings.put("speechVoice", current.speechVoice);
        voiceSettings.put("preferredVoiceSessionId", current.preferredVoiceSessionId);
        voiceSettings.put("selectedMicDeviceId", current.selectedMicDeviceId);
        voiceSettings.put("recognitionStartTimeoutMs", current.recognitionStartTimeoutMs);
        voiceSettings.put("recognitionCompletionTimeoutMs", current.recognitionCompletionTimeoutMs);
        voiceSettings.put("recognitionEndSilenceMs", current.recognitionEndSilenceMs);
        JSObject sessionTitles = new JSObject();
        for (java.util.Map.Entry<String, String> entry : current.sessionTitles.entrySet()) {
            sessionTitles.put(entry.getKey(), entry.getValue());
        }
        voiceSettings.put("ttsGain", (double) current.ttsGain);
        voiceSettings.put("recognitionCueEnabled", current.recognitionCueEnabled);
        voiceSettings.put("recognitionCueGain", (double) current.recognitionCueGain);
        voiceSettings.put("recognizeStopCommandEnabled", current.recognizeStopCommandEnabled);
        voiceSettings.put("startupPreRollMs", current.startupPreRollMs);
        voiceSettings.put(
            "standaloneNotificationPlaybackEnabled",
            current.standaloneNotificationPlaybackEnabled
        );
        voiceSettings.put(
            "notificationTitlePlaybackEnabled",
            current.notificationTitlePlaybackEnabled
        );
        String activeSessionId = AssistantVoiceConfig.loadRuntimeActiveSessionId(getContext());
        String activeDisplayTitle = AssistantVoiceConfig.loadRuntimeActiveDisplayTitle(getContext());

        JSObject payload = new JSObject();
        payload.put("state", AssistantVoiceConfig.loadRuntimeState(getContext()));
        payload.put("turnOriginId", AssistantVoiceTurnOrigin.get());
        payload.put("realtimeMuted", AssistantVoiceConfig.loadRuntimeRealtimeMuted(getContext()));
        payload.put("activeSessionId", activeSessionId.isEmpty() ? null : activeSessionId);
        payload.put("activeDisplayTitle", activeDisplayTitle.isEmpty() ? null : activeDisplayTitle);
        payload.put("voiceSettings", voiceSettings);
        payload.put("assistantBaseUrl", current.assistantBaseUrl);
        payload.put("selectedSession", selection.length() == 0 ? null : selection);
        payload.put("sessionTitles", sessionTitles);
        payload.put("inputContext", inputContext);
        payload.put("effectiveTtsGain", (double) current.ttsGain);
        payload.put("effectiveRecognitionCueGain", (double) current.recognitionCueGain);

        String error = AssistantVoiceConfig.loadRuntimeError(getContext());
        if (!error.isEmpty()) {
            payload.put("lastError", error);
        }
        return payload;
    }

    private AssistantVoiceConfig extractVoiceSettingsConfig(
        PluginCall call,
        AssistantVoiceConfig current
    ) {
        JSONObject settings = call.getData().optJSONObject("settings");
        return settings == null ? null : current.withVoiceSettings(settings);
    }

    private AssistantVoiceNotificationRecord extractNotification(PluginCall call) {
        JSONObject notification = call.getData().optJSONObject("notification");
        if (notification == null) {
            return null;
        }
        Integer sessionActivitySeq =
            notification.has("sessionActivitySeq") && !notification.isNull("sessionActivitySeq")
                ? Integer.valueOf(notification.optInt("sessionActivitySeq"))
                : null;
        return new AssistantVoiceNotificationRecord(
            optTrimmedString(notification, "id", null),
            optTrimmedString(notification, "kind", null),
            optTrimmedString(notification, "source", null),
            optTrimmedString(notification, "title", null),
            optTrimmedString(notification, "body", null),
            optTrimmedString(notification, "readAt", null),
            optTrimmedString(notification, "sessionId", null),
            optTrimmedString(notification, "sessionTitle", null),
            optTrimmedString(notification, "voiceMode", null),
            optTrimmedString(notification, "ttsText", null),
            optTrimmedString(notification, "sourceEventId", null),
            sessionActivitySeq,
            optTrimmedString(notification, "turnOriginId", null),
            optTrimmedString(notification, "turnSource", null)
        );
    }

    private static String optTrimmedString(JSONObject object, String key, String fallback) {
        if (object == null || key == null || key.isEmpty() || object.isNull(key)) {
            return fallback;
        }
        String value = object.optString(key, fallback);
        return value == null ? null : value.trim();
    }

    private boolean hasVoiceModePermissions() {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState("notifications") == PermissionState.GRANTED;
        }
        return true;
    }

    private void requestVoiceModePermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAliases(
                new String[] { "microphone", "notifications" },
                call,
                "handleVoiceModePermissionResult"
            );
            return;
        }
        requestPermissionForAlias("microphone", call, "handleVoiceModePermissionResult");
    }

    private static String describeNotification(AssistantVoiceNotificationRecord notification) {
        if (notification == null) {
            return "notification=<null>";
        }
        return "notificationId=" + safe(notification.id)
            + " sessionId=" + safe(notification.sessionId)
            + " kind=" + safe(notification.kind)
            + " voiceMode=" + safe(notification.voiceMode)
            + " hasSpeech=" + (!notification.resolveSpokenText(false).isEmpty());
    }

    private void checkLaunchIntentForOpenSession() {
        if (getActivity() == null) {
            return;
        }
        checkIntentForOpenSession(getActivity().getIntent());
    }

    private void checkIntentForOpenSession(Intent intent) {
        if (intent == null) {
            return;
        }
        String sessionId = intent.getStringExtra(AssistantVoiceRuntimeService.EXTRA_OPEN_SESSION_ID);
        if (sessionId == null || sessionId.trim().isEmpty()) {
            return;
        }
        intent.removeExtra(AssistantVoiceRuntimeService.EXTRA_OPEN_SESSION_ID);
        Log.d(TAG, "openSession from intent sessionId=" + safe(sessionId));
        JSObject payload = new JSObject();
        payload.put("sessionId", sessionId.trim());
        notifyListeners("openSession", payload, true);
    }

    private static String safe(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.isEmpty() ? "<empty>" : trimmed;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
