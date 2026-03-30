package com.assistant.mobile.voice;

final class AssistantVoiceSessionSocketProtocol {
    private AssistantVoiceSessionSocketProtocol() {}

    static String buildHelloMessage(String sessionId) {
        String trimmedSessionId = trim(sessionId);
        String subscriptions = trimmedSessionId.isEmpty()
            ? "[]"
            : "[\"" + escapeJsonString(trimmedSessionId) + "\"]";
        return "{\"type\":\"hello\",\"protocolVersion\":2,\"subscriptions\":" + subscriptions + "}";
    }

    static String buildSubscribeMessage(String sessionId) {
        return "{\"type\":\"subscribe\",\"sessionId\":\""
            + escapeJsonString(trim(sessionId))
            + "\"}";
    }

    static String buildUnsubscribeMessage(String sessionId) {
        return "{\"type\":\"unsubscribe\",\"sessionId\":\""
            + escapeJsonString(trim(sessionId))
            + "\"}";
    }

    static AssistantVoicePromptEvent parsePromptMessage(String rawMessage, String selectedSessionId) {
        String expectedSessionId = trim(selectedSessionId);
        if (rawMessage == null || rawMessage.trim().isEmpty() || expectedSessionId.isEmpty()) {
            return null;
        }

        String messageType = trim(findStringField(rawMessage, "type", 0));
        if (!"chat_event".equals(messageType)) {
            return null;
        }

        String messageSessionId = trim(findStringField(rawMessage, "sessionId", 0));
        if (!expectedSessionId.equals(messageSessionId)) {
            return null;
        }

        String eventJson = extractObjectField(rawMessage, "event", 0);
        if (eventJson.isEmpty()) {
            return null;
        }

        String eventType = trim(findStringField(eventJson, "type", 0));
        if (!"tool_call".equals(eventType)) {
            return null;
        }

        String eventId = trim(findStringField(eventJson, "id", 0));
        String eventSessionId = trim(findStringField(eventJson, "sessionId", 0));
        String payloadJson = extractObjectField(eventJson, "payload", 0);
        if (eventId.isEmpty() || eventSessionId.isEmpty() || payloadJson.isEmpty()) {
            return null;
        }

        String toolName = trim(findStringField(payloadJson, "toolName", 0));
        String toolCallId = trim(findStringField(payloadJson, "toolCallId", 0));
        String argsJson = extractObjectField(payloadJson, "args", 0);
        String text = trim(findStringField(argsJson, "text", 0));
        if (
            !AssistantVoiceInteractionRules.isVoicePromptTool(toolName)
                || toolCallId.isEmpty()
                || text.isEmpty()
        ) {
            return null;
        }

        return new AssistantVoicePromptEvent(eventId, eventSessionId, toolCallId, toolName, text);
    }

    static String parseSubscriptionSessionId(String rawMessage, String type) {
        if (rawMessage == null || rawMessage.trim().isEmpty() || type == null) {
            return "";
        }
        String actualType = trim(findStringField(rawMessage, "type", 0));
        if (!type.equals(actualType)) {
            return "";
        }
        return trim(findStringField(rawMessage, "sessionId", 0));
    }

    private static String extractObjectField(String json, String key, int fromIndex) {
        int keyIndex = findKey(json, key, fromIndex);
        if (keyIndex < 0) {
            return "";
        }
        int valueIndex = skipWhitespace(json, keyIndex + key.length() + 2);
        if (valueIndex >= json.length() || json.charAt(valueIndex) != ':') {
            return "";
        }
        int objectStart = skipWhitespace(json, valueIndex + 1);
        if (objectStart >= json.length() || json.charAt(objectStart) != '{') {
            return "";
        }
        int objectEnd = findMatchingBrace(json, objectStart);
        if (objectEnd < 0) {
            return "";
        }
        return json.substring(objectStart, objectEnd + 1);
    }

    private static String findStringField(String json, String key, int fromIndex) {
        int keyIndex = findKey(json, key, fromIndex);
        if (keyIndex < 0) {
            return "";
        }
        int valueIndex = skipWhitespace(json, keyIndex + key.length() + 2);
        if (valueIndex >= json.length() || json.charAt(valueIndex) != ':') {
            return "";
        }
        int stringStart = skipWhitespace(json, valueIndex + 1);
        if (stringStart >= json.length() || json.charAt(stringStart) != '"') {
            return "";
        }
        StringBuilder value = new StringBuilder();
        boolean escaping = false;
        for (int index = stringStart + 1; index < json.length(); index += 1) {
            char current = json.charAt(index);
            if (escaping) {
                value.append(unescapeJsonChar(current));
                escaping = false;
                continue;
            }
            if (current == '\\') {
                escaping = true;
                continue;
            }
            if (current == '"') {
                return value.toString();
            }
            value.append(current);
        }
        return "";
    }

    private static int findKey(String json, String key, int fromIndex) {
        if (json == null || key == null || key.isEmpty()) {
            return -1;
        }
        return json.indexOf("\"" + key + "\"", Math.max(0, fromIndex));
    }

    private static int skipWhitespace(String json, int fromIndex) {
        int index = Math.max(0, fromIndex);
        while (index < json.length()) {
            char current = json.charAt(index);
            if (!Character.isWhitespace(current)) {
                return index;
            }
            index += 1;
        }
        return json.length();
    }

    private static int findMatchingBrace(String json, int objectStart) {
        int depth = 0;
        boolean inString = false;
        boolean escaping = false;
        for (int index = objectStart; index < json.length(); index += 1) {
            char current = json.charAt(index);
            if (inString) {
                if (escaping) {
                    escaping = false;
                } else if (current == '\\') {
                    escaping = true;
                } else if (current == '"') {
                    inString = false;
                }
                continue;
            }
            if (current == '"') {
                inString = true;
                continue;
            }
            if (current == '{') {
                depth += 1;
                continue;
            }
            if (current == '}') {
                depth -= 1;
                if (depth == 0) {
                    return index;
                }
            }
        }
        return -1;
    }

    private static String escapeJsonString(String value) {
        StringBuilder escaped = new StringBuilder();
        for (int index = 0; index < value.length(); index += 1) {
            char current = value.charAt(index);
            if (current == '"' || current == '\\') {
                escaped.append('\\');
            }
            escaped.append(current);
        }
        return escaped.toString();
    }

    private static char unescapeJsonChar(char current) {
        switch (current) {
            case '"':
            case '\\':
            case '/':
                return current;
            case 'b':
                return '\b';
            case 'f':
                return '\f';
            case 'n':
                return '\n';
            case 'r':
                return '\r';
            case 't':
                return '\t';
            default:
                return current;
        }
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
