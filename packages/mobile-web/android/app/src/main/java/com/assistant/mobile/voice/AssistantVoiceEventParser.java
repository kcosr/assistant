package com.assistant.mobile.voice;

final class AssistantVoiceEventParser {
    private AssistantVoiceEventParser() {}

    static AssistantVoicePromptEvent parsePromptEventJson(String eventJson) {
        if (eventJson == null || eventJson.trim().isEmpty()) {
            return null;
        }
        String eventType = trim(findStringField(eventJson, "type", 0));
        if (!"tool_call".equals(eventType)) {
            return null;
        }

        String eventId = trim(findStringField(eventJson, "id", 0));
        String sessionId = trim(findStringField(eventJson, "sessionId", 0));
        String payloadJson = extractObjectField(eventJson, "payload", 0);
        if (eventId.isEmpty() || sessionId.isEmpty() || payloadJson.isEmpty()) {
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

        return new AssistantVoicePromptEvent(eventId, sessionId, toolCallId, toolName, text);
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
