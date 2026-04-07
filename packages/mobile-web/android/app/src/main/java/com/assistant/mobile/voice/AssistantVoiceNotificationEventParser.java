package com.assistant.mobile.voice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class AssistantVoiceNotificationEventParser {
    private AssistantVoiceNotificationEventParser() {}

    static final class NotificationUpdate {
        final String eventType;
        final AssistantVoiceNotificationRecord notification;
        final String id;
        final List<AssistantVoiceNotificationRecord> notifications;

        NotificationUpdate(
            String eventType,
            AssistantVoiceNotificationRecord notification,
            String id,
            List<AssistantVoiceNotificationRecord> notifications
        ) {
            this.eventType = trim(eventType);
            this.notification = notification;
            this.id = trim(id);
            this.notifications = notifications == null ? new ArrayList<>() : notifications;
        }
    }

    static NotificationUpdate parsePanelEvent(String rawMessage) {
        if (rawMessage == null || rawMessage.trim().isEmpty()) {
            return null;
        }
        try {
            JSONObject message = new JSONObject(rawMessage);
            if (!"panel_event".equals(trim(message.optString("type")))) {
                return null;
            }
            if (!"notifications".equals(trim(message.optString("panelType")))) {
                return null;
            }
            JSONObject payload = message.optJSONObject("payload");
            if (payload == null || !"notification_update".equals(trim(payload.optString("type")))) {
                return null;
            }
            String eventType = trim(payload.optString("event"));
            return new NotificationUpdate(
                eventType,
                parseNotification(payload.optJSONObject("notification")),
                payload.optString("id", ""),
                parseNotificationsArray(payload.optJSONArray("notifications"))
            );
        } catch (Exception ignored) {
            return null;
        }
    }

    static List<AssistantVoiceNotificationRecord> parseListResponse(String rawJson) {
        if (rawJson == null || rawJson.trim().isEmpty()) {
            return new ArrayList<>();
        }
        try {
            JSONObject root = new JSONObject(rawJson);
            JSONObject result = root.optJSONObject("result");
            if (result == null) {
                result = root;
            }
            return parseNotificationsArray(result.optJSONArray("notifications"));
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
    }

    private static List<AssistantVoiceNotificationRecord> parseNotificationsArray(JSONArray array) {
        List<AssistantVoiceNotificationRecord> notifications = new ArrayList<>();
        if (array == null) {
            return notifications;
        }
        for (int index = 0; index < array.length(); index += 1) {
            AssistantVoiceNotificationRecord record = parseNotification(array.optJSONObject(index));
            if (record != null) {
                notifications.add(record);
            }
        }
        return notifications;
    }

    private static AssistantVoiceNotificationRecord parseNotification(JSONObject object) {
        if (object == null) {
            return null;
        }
        String id = trim(object.optString("id"));
        String title = trim(object.optString("title"));
        String body = trim(object.optString("body"));
        if (id.isEmpty() || title.isEmpty() || body.isEmpty()) {
            return null;
        }
        Integer sessionActivitySeq =
            object.has("sessionActivitySeq") && !object.isNull("sessionActivitySeq")
                ? Integer.valueOf(object.optInt("sessionActivitySeq"))
                : null;
        return new AssistantVoiceNotificationRecord(
            id,
            object.optString("kind", "notification"),
            object.optString("source", "tool"),
            title,
            body,
            object.optString("readAt", ""),
            object.optString("sessionId", ""),
            object.optString("sessionTitle", ""),
            object.optString("voiceMode", "none"),
            object.optString("ttsText", ""),
            object.optString("sourceEventId", ""),
            sessionActivitySeq
        );
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
