package com.assistant.mobile.voice;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;

import org.json.JSONObject;

final class AssistantVoiceEventLog {
    private static final String TAG = "AssistantVoiceEventLog";
    static final String FILE_NAME = "voice-runtime.log";
    static final int MAX_BYTES = 256 * 1024;
    static final int RETAIN_BYTES = 192 * 1024;

    private AssistantVoiceEventLog() {}

    static JSONObject details() {
        return new JSONObject();
    }

    static void put(JSONObject target, String key, Object value) {
        if (target == null || key == null || value == null) {
            return;
        }
        try {
            target.put(key, value);
        } catch (Exception ignored) {
        }
    }

    static void record(Context context, String event) {
        record(context, event, null);
    }

    static void record(Context context, String event, JSONObject details) {
        if (context == null) {
            return;
        }
        String normalizedEvent = safe(event);
        long now = System.currentTimeMillis();
        JSONObject entry = new JSONObject();
        put(entry, "ts", now);
        put(entry, "tsIso", formatTimestamp(now));
        put(entry, "event", normalizedEvent);
        if (details != null && details.length() > 0) {
            put(entry, "details", details);
        }
        try {
            appendLine(
                new File(context.getFilesDir(), FILE_NAME),
                formatLine(entry),
                MAX_BYTES,
                RETAIN_BYTES
            );
        } catch (Exception error) {
            Log.w(TAG, "Failed to append voice runtime log entry event=" + normalizedEvent, error);
        }
    }

    static String formatLine(JSONObject entry) {
        return entry.toString() + "\n";
    }

    static void appendLine(File file, String line, int maxBytes, int retainBytes) throws Exception {
        byte[] lineBytes = line.getBytes(StandardCharsets.UTF_8);
        if (lineBytes.length >= maxBytes) {
            byte[] truncated = Arrays.copyOfRange(
                lineBytes,
                Math.max(0, lineBytes.length - maxBytes),
                lineBytes.length
            );
            try (FileOutputStream stream = new FileOutputStream(file, false)) {
                stream.write(truncated);
            }
            return;
        }

        long currentLength = file.isFile() ? file.length() : 0L;
        if (currentLength + lineBytes.length <= maxBytes) {
            try (FileOutputStream stream = new FileOutputStream(file, true)) {
                stream.write(lineBytes);
            }
            return;
        }

        byte[] existingBytes = readAllBytes(file);
        byte[] retained = trimToRecentBytes(existingBytes, retainBytes);
        try (FileOutputStream stream = new FileOutputStream(file, false)) {
            stream.write(retained);
            stream.write(lineBytes);
        }
    }

    static byte[] trimToRecentBytes(byte[] existingBytes, int retainBytes) {
        if (existingBytes == null || existingBytes.length <= retainBytes) {
            return existingBytes == null ? new byte[0] : existingBytes;
        }
        int start = Math.max(0, existingBytes.length - retainBytes);
        while (start < existingBytes.length && existingBytes[start] != '\n') {
            start += 1;
        }
        if (start < existingBytes.length) {
            start += 1;
        }
        if (start >= existingBytes.length) {
            return new byte[0];
        }
        return Arrays.copyOfRange(existingBytes, start, existingBytes.length);
    }

    private static byte[] readAllBytes(File file) throws Exception {
        if (file == null || !file.isFile()) {
            return new byte[0];
        }
        try (
            FileInputStream input = new FileInputStream(file);
            ByteArrayOutputStream output = new ByteArrayOutputStream((int) Math.max(file.length(), 0L))
        ) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static String safe(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? "" : trimmed;
    }

    private static String formatTimestamp(long timestampMs) {
        try {
            return new SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                Locale.US
            ).format(new Date(timestampMs));
        } catch (Exception ignored) {
            return "";
        }
    }
}
