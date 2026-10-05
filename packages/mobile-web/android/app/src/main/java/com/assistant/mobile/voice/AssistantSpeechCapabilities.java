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
    final long maxBufferBytes, maxMessageBytes, maxOutputBytes, idleTimeoutMs, maxSessionMs;
    final int maxTextLength;

    private AssistantSpeechCapabilities(JSONObject recognition, JSONObject speech) {
        maxBufferBytes = integer(recognition, "max_buffer_bytes", PACKET_BYTES, 9007199254740991L);
        maxMessageBytes = integer(recognition, "max_message_bytes", 8192, 9007199254740991L);
        maxOutputBytes = integer(recognition, "max_output_bytes", 1024, 9007199254740991L);
        idleTimeoutMs = timeout(recognition, "idle_timeout_seconds");
        maxSessionMs = timeout(recognition, "max_session_seconds");
        if ((maxBufferBytes & 1) != 0 || idleTimeoutMs < 40000 || maxSessionMs < 125000) throw unsupported();
        maxTextLength = (int) integer(speech, "max_text_length", 2, Integer.MAX_VALUE);
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

    static AssistantSpeechCapabilities parse(JSONObject listing, String sttModel, String ttsModel, String voice) {
        try {
            JSONArray data = listing.optJSONArray("data");
            if (!"list".equals(listing.optString("object")) || data == null || data.length() > 1000) throw unsupported();
            JSONObject recognition = null, speech = null;
            Set<String> identifiers = new HashSet<>();
            for (int i = 0; i < data.length(); i++) {
                JSONObject model = data.optJSONObject(i);
                String id = identifier(model, "id");
                if (!identifiers.add(id)) throw unsupported();
                if ("transcription".equals(model.optString("task"))) {
                    if (id.equals(sttModel)) {
                        if (!Boolean.TRUE.equals(model.opt("ready"))) throw unsupported();
                        recognition = model.optJSONObject("realtime");
                    }
                } else if ("speech".equals(model.optString("task"))) {
                    if (id.equals(ttsModel)) {
                        if (!Boolean.TRUE.equals(model.opt("ready"))) throw unsupported();
                        speech = model;
                    }
                }
            }
            if (recognition == null || speech == null) throw unsupported();
            boolean selectedVoice = false;
            JSONArray advertised = speech.optJSONArray("voices");
            if (advertised == null || advertised.length() > 1000) throw unsupported();
            for (int i = 0; i < advertised.length(); i++) {
                String id = identifier(advertised.optJSONObject(i), "id");
                selectedVoice |= voice.equals(id);
            }
            if (!selectedVoice) throw unsupported();
            return new AssistantSpeechCapabilities(recognition, speech);
        } catch (RuntimeException invalid) { throw unsupported(); }
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
