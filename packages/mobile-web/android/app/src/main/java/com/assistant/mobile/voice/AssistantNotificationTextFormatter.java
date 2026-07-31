package com.assistant.mobile.voice;

final class AssistantNotificationTextFormatter {
    private static final String BOLD_MARKER = "**";

    private AssistantNotificationTextFormatter() {}

    static CharSequence format(String value) {
        String text = value == null ? "" : value;
        StringBuilder output = new StringBuilder();
        int cursor = 0;

        while (cursor < text.length()) {
            int open = text.indexOf(BOLD_MARKER, cursor);
            if (open < 0) {
                output.append(text, cursor, text.length());
                break;
            }
            int close = text.indexOf(BOLD_MARKER, open + BOLD_MARKER.length());
            if (close < 0) {
                output.append(text, cursor, text.length());
                break;
            }
            if (close == open + BOLD_MARKER.length()) {
                int markerEnd = close + BOLD_MARKER.length();
                output.append(text, cursor, markerEnd);
                cursor = markerEnd;
                continue;
            }

            output.append(text, cursor, open);
            output.append(text, open + BOLD_MARKER.length(), close);
            cursor = close + BOLD_MARKER.length();
        }

        return output.toString();
    }
}
