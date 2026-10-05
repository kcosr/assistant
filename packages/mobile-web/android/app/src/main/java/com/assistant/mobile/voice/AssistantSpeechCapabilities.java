package com.assistant.mobile.voice;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Selected-model contract from a fresh, authenticated server response. */
final class AssistantSpeechCapabilities {
    static final int SAMPLE_RATE = 24000;
    static final int PACKET_BYTES = 4800;
    static final long RESULT_TIMEOUT_MS = 240000;
    static final long READY_SESSION_RESERVE_MS = 30000 + 60000 + RESULT_TIMEOUT_MS;
    final long maxBufferBytes, maxMessageBytes, maxOutputBytes, idleTimeoutMs, maxSessionMs;
    final int maxTextLength;

    private AssistantSpeechCapabilities(JSONObject recognition, JSONObject speech) {
        maxBufferBytes = recognition == null ? 0 : integer(recognition, "max_buffer_bytes", PACKET_BYTES, 9007199254740991L);
        maxMessageBytes = recognition == null ? 0 : integer(recognition, "max_message_bytes", 8192, 9007199254740991L);
        maxOutputBytes = recognition == null ? 0 : integer(recognition, "max_output_bytes", 1024, 9007199254740991L);
        idleTimeoutMs = recognition == null ? 0 : timeout(recognition, "idle_timeout_seconds");
        maxSessionMs = recognition == null ? 0 : timeout(recognition, "max_session_seconds");
        if (recognition != null && ((maxBufferBytes & 1) != 0 || idleTimeoutMs < 40000
            || maxSessionMs < READY_SESSION_RESERVE_MS + 20000)) throw unsupported();
        maxTextLength = speech == null ? 0 : (int) integer(speech, "max_text_length", 2, Integer.MAX_VALUE);
        if (speech == null) return;
        JSONObject audio = speech.optJSONObject("audio");
        integer(audio, "sample_rate", SAMPLE_RATE, SAMPLE_RATE);
        integer(audio, "channels", 1, 1);
        boolean pcm = false;
        JSONArray formats = speech.optJSONArray("output_formats");
        if (formats != null) for (int i = 0; i < formats.length(); i++) {
            JSONObject format = formats.optJSONObject(i);
            if (format != null && "pcm".equals(format.optString("id")) && "pcm_s16le".equals(format.optString("encoding"))) pcm = true;
        }
        if (!pcm || !Boolean.TRUE.equals(speech.opt("streams"))) throw unsupported();
    }

    static AssistantSpeechCapabilities parseRecognition(JSONObject listing, String model) {
        JSONObject selected = selectedModel(listing, model, "transcription");
        JSONObject realtime = selected.optJSONObject("realtime");
        if (realtime == null) throw unsupported();
        return new AssistantSpeechCapabilities(realtime, null);
    }

    static AssistantSpeechCapabilities parseSynthesis(JSONObject listing, String model, String voice) {
        JSONObject selected = selectedModel(listing, model, "speech");
        JSONArray voices = selected.optJSONArray("voices");
        if (voices == null || voices.length() > 1000) throw unsupported();
        boolean available = false;
        for (int i = 0; i < voices.length(); i++) available |= voice.equals(identifier(voices.optJSONObject(i), "id"));
        if (!available) throw unsupported();
        return new AssistantSpeechCapabilities(null, selected);
    }

    /** A healthy operation remains usable while the other model warms up or is unauthorized. */
    static void validateAvailable(JSONObject listing, String sttModel, String ttsModel, String voice) {
        try { parseRecognition(listing, sttModel); return; } catch (IllegalArgumentException unavailable) { }
        parseSynthesis(listing, ttsModel, voice);
    }

    private static JSONObject selectedModel(JSONObject listing, String selected, String task) {
        if (listing == null || !"list".equals(listing.optString("object"))) throw unsupported();
        JSONArray data = listing.optJSONArray("data");
        if (data == null || data.length() > 1000) throw unsupported();
        Set<String> identifiers = new HashSet<>();
        JSONObject match = null;
        for (int i = 0; i < data.length(); i++) {
            JSONObject model = data.optJSONObject(i);
            String id = identifier(model, "id");
            if (!identifiers.add(id)) throw unsupported();
            if (id.equals(selected) && task.equals(model.optString("task"))) match = model;
        }
        if (match == null || !Boolean.TRUE.equals(match.opt("ready"))) throw unsupported();
        return match;
    }

    /** Expose public picker metadata only, never arbitrary backend fields. */
    static JSONObject discovery(JSONObject listing) {
        JSONArray input = listing.optJSONArray("data"), output = new JSONArray();
        if (!"list".equals(listing.optString("object")) || input == null || input.length() > 1000) throw unsupported();
        for (int i = 0; i < input.length(); i++) {
            JSONObject model = input.optJSONObject(i), clean = new JSONObject();
            identifier(model, "id"); identifier(model, "task");
            for (String key : new String[] { "id", "task", "display_label", "default", "ready", "default_voice", "max_text_length", "streams" })
                if (model.has(key)) put(clean, key, model.opt(key));
            for (String key : new String[] { "realtime", "audio", "speed" }) {
                JSONObject source = model.optJSONObject(key);
                if (source == null) continue;
                JSONObject fields = new JSONObject();
                String[] allowed = key.equals("realtime") ? new String[] { "max_buffer_bytes", "max_message_bytes", "max_output_bytes", "idle_timeout_seconds", "max_session_seconds" } :
                    key.equals("audio") ? new String[] { "sample_rate", "channels" } : new String[] { "min", "max", "default" };
                for (String field : allowed) if (source.has(field)) put(fields, field, source.opt(field));
                put(clean, key, fields);
            }
            for (String key : new String[] { "voices", "output_formats" }) {
                JSONArray source = model.optJSONArray(key);
                if (source == null) continue;
                if (source.length() > 1000) throw unsupported();
                JSONArray values = new JSONArray();
                for (int j = 0; j < source.length(); j++) {
                    JSONObject entry = source.optJSONObject(j), fields = new JSONObject();
                    identifier(entry, "id");
                    for (String field : new String[] { "id", "display_label", "encoding" }) if (entry.has(field)) put(fields, field, entry.opt(field));
                    values.put(fields);
                }
                put(clean, key, values);
            }
            output.put(clean);
        }
        return object("object", "list", "data", output);
    }

    static long integer(JSONObject value, String key, long min, long max) {
        Object raw = value == null ? null : value.opt(key);
        if (!(raw instanceof Number)) throw unsupported();
        try {
            long number = new BigDecimal(raw.toString()).longValueExact();
            if (number < min || number > max) throw unsupported();
            return number;
        } catch (ArithmeticException invalid) { throw unsupported(); }
    }
    private static long timeout(JSONObject value, String key) {
        Object raw = value.opt(key);
        if (!(raw instanceof Number)) throw unsupported();
        try {
            BigDecimal seconds = new BigDecimal(raw.toString());
            if (seconds.signum() <= 0 || seconds.compareTo(BigDecimal.valueOf(Integer.MAX_VALUE)) > 0) throw unsupported();
            return seconds.multiply(BigDecimal.valueOf(1000)).setScale(0, RoundingMode.FLOOR).longValueExact();
        } catch (NumberFormatException | ArithmeticException invalid) { throw unsupported(); }
    }
    static String identifier(JSONObject value, String key) {
        Object raw = value == null ? null : value.opt(key);
        if (!(raw instanceof String)) throw unsupported();
        String id = (String) raw;
        if (id.isEmpty() || id.length() > 256 || !id.equals(id.trim()) || id.chars().anyMatch(Character::isISOControl)) throw unsupported();
        return id;
    }
    static JSONObject object(Object... values) {
        JSONObject object = new JSONObject();
        for (int i = 0; i < values.length; i += 2) put(object, (String) values[i], values[i + 1]);
        return object;
    }
    static void put(JSONObject object, String key, Object value) {
        try { object.put(key, value == null ? JSONObject.NULL : value); }
        catch (org.json.JSONException invalid) { throw unsupported(); }
    }
    static IllegalArgumentException unsupported() { return new IllegalArgumentException("speech_server_configuration_unsupported"); }
}
