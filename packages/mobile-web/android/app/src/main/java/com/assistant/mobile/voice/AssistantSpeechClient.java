package com.assistant.mobile.voice;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.BufferedSink;
import okio.ByteString;
import org.json.JSONObject;

/** Authenticated local speech-server transport. Owns neither microphone nor playback hardware.
 * Callbacks are fenced against cancellation and run on network, spool-reader, or timer threads. Keep callbacks short;
 * post runtime work to its handler, including cancellation of other operations.
 */
public final class AssistantSpeechClient implements Closeable {
    public interface Operation { void cancel(); }
    public interface Clock { long nowMs(); }
    public interface DiscoveryListener { void ready(JSONObject catalog); void failed(String safeMessage); }
    public interface SpeechListener { void pcm(byte[] chunk, int sampleRate); void completed(); void failed(String safeMessage); }
    public interface RecognitionListener { void ready(); void completed(String text, int durationMs); void failed(String safeMessage); }
    public interface Recognition extends Operation {
        boolean append(byte[] pcm);
        void commit();
        /** Effective utterance budget, available after ready(). */
        long maxBufferBytes();
    }
    private static final int CATALOG_LIMIT = 1024 * 1024;
    private static final int EVENT_LIMIT = 512 * 1024;
    private static final long QUEUE_LIMIT = 512 * 1024;
    private static final long UTTERANCE_BYTES = 24000 * 2L * 60;
    private static final long SPEECH_BYTES = 24000 * 2L * 10 * 60;
    private static final long RESULT_MS = AssistantSpeechCapabilities.RESULT_TIMEOUT_MS;
    private static final long SYNTHESIS_REQUEST_MS = 14 * 60 * 1000;
    private final String baseUrl, bearerToken, sttModel, ttsModel, voice;
    private final Clock clock;
    private final OkHttpClient http, synthesisHttp, sockets;
    private final File cacheDirectory;
    private final ExecutorService playbackReaders = Executors.newCachedThreadPool(work -> {
        Thread thread = new Thread(work, "assistant-speech-spool"); thread.setDaemon(true); return thread;
    });
    private final ScheduledThreadPoolExecutor timers = new ScheduledThreadPoolExecutor(1, work -> {
        Thread thread = new Thread(work, "assistant-speech-deadlines"); thread.setDaemon(true); return thread;
    });
    private final Set<Work> active = new HashSet<>();
    private boolean closed;

    public AssistantSpeechClient(String baseUrl, String bearerToken, String sttModel, String ttsModel, String voice) {
        this(baseUrl, bearerToken, sttModel, ttsModel, voice, new OkHttpClient(), () -> TimeUnit.NANOSECONDS.toMillis(System.nanoTime()));
    }
    public AssistantSpeechClient(String baseUrl, String bearerToken, String sttModel, String ttsModel, String voice, Clock clock) {
        this(baseUrl, bearerToken, sttModel, ttsModel, voice, clock, new File(System.getProperty("java.io.tmpdir")));
    }
    public AssistantSpeechClient(String baseUrl, String bearerToken, String sttModel, String ttsModel, String voice, Clock clock, File cacheDirectory) {
        this(baseUrl, bearerToken, sttModel, ttsModel, voice, new OkHttpClient(), clock, cacheDirectory);
    }
    AssistantSpeechClient(String baseUrl, String bearerToken, String sttModel, String ttsModel, String voice, OkHttpClient client, Clock clock) {
        this(baseUrl, bearerToken, sttModel, ttsModel, voice, client, clock, new File(System.getProperty("java.io.tmpdir")));
    }
    private AssistantSpeechClient(String baseUrl, String bearerToken, String sttModel, String ttsModel, String voice, OkHttpClient client, Clock clock, File cacheDirectory) {
        this.cacheDirectory = java.util.Objects.requireNonNull(cacheDirectory);
        this.clock = java.util.Objects.requireNonNull(clock);
        try {
            if (baseUrl == null || baseUrl.length() > 2048) throw new IllegalArgumentException();
            URI uri = new URI(baseUrl);
            if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null ||
                uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getPort() > 65535)
                throw new IllegalArgumentException();
            String normalized = HttpUrl.get(baseUrl).toString();
            while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
            this.baseUrl = normalized;
        } catch (Exception invalid) { throw new IllegalArgumentException("speech_invalid_base_url"); }
        if (bearerToken == null || !bearerToken.matches("[\\x21-\\x7e]{1,8192}")) throw new IllegalArgumentException("speech_credential_required");
        this.bearerToken = bearerToken;
        this.sttModel = configured(sttModel); this.ttsModel = configured(ttsModel); this.voice = configured(voice);
        timers.setRemoveOnCancelPolicy(true);
        sockets = client.newBuilder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).callTimeout(0, TimeUnit.SECONDS).build();
        http = sockets.newBuilder().readTimeout(30, TimeUnit.SECONDS).callTimeout(11, TimeUnit.MINUTES).build();
        // Queue admission and first synthesis can take up to the server's 180-second deadline.
        synthesisHttp = http.newBuilder().readTimeout(210, TimeUnit.SECONDS).build();
    }
    private static String configured(String value) {
        if (value == null || value.isEmpty() || value.length() > 256 || !value.equals(value.trim()) || value.chars().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("speech_configuration_required");
        return value;
    }
    public Operation discover(DiscoveryListener listener) {
        Discovery work = new Discovery(listener);
        if (register(work)) work.fetchCatalog(catalog -> { if (work.finish()) listener.ready(catalog); });
        return work;
    }
    public Operation speak(String text, SpeechListener listener) {
        Speech work = new Speech(listener);
        if (register(work)) {
            if (text == null || text.trim().isEmpty() || text.length() > 65536) work.fail("speech_invalid_input");
            else work.fetch(false, caps -> work.start(text, caps.maxTextLength));
        }
        return work;
    }
    public Recognition recognize(RecognitionListener listener) {
        Recording work = new Recording(listener);
        if (register(work)) work.fetch(true, work::start);
        return work;
    }
    private boolean register(Work work) {
        String failure = null;
        synchronized (this) {
            if (closed) failure = "speech_client_closed";
            else if (active.size() >= 4) failure = "speech_request_limit";
            else active.add(work);
        }
        if (failure != null) work.fail(failure);
        return failure == null;
    }
    private Request.Builder request(String suffix) {
        return new Request.Builder().url(baseUrl + suffix).header("Authorization", "Bearer " + bearerToken);
    }
    @Override public void close() {
        List<Work> pending;
        synchronized (this) { closed = true; pending = new ArrayList<>(active); }
        for (Work work : pending) work.cancel();
        timers.shutdownNow();
        playbackReaders.shutdownNow();
    }
    private interface CatalogReady { void ready(JSONObject catalog); }
    private interface CapabilitiesReady { void ready(AssistantSpeechCapabilities capabilities); }
    private abstract class Work implements Operation {
        boolean ended;
        Call call;
        private ScheduledFuture<?> timeout;
        private long timerGeneration;
        synchronized void timer(long delayMs, String error) {
            final long generation = ++timerGeneration;
            if (timeout != null) timeout.cancel(false);
            if (!ended) timeout = timers.schedule(() -> {
                synchronized (Work.this) { if (!ended && generation == timerGeneration) fail(error); }
            }, Math.max(1, delayMs), TimeUnit.MILLISECONDS);
        }
        synchronized void clearTimer() {
            timerGeneration++;
            if (timeout != null) timeout.cancel(false);
            timeout = null;
        }
        synchronized boolean finish() {
            if (ended) return false;
            ended = true; clearTimer();
            synchronized (AssistantSpeechClient.this) { active.remove(this); }
            return true;
        }
        @Override public synchronized void cancel() { if (finish()) stop(); }
        synchronized void fail(String safeMessage) { if (finish()) { stop(); failed(safeMessage); } }
        void stop() { if (call != null) call.cancel(); }
        abstract void failed(String safeMessage);
        final synchronized void fetch(boolean recognition, CapabilitiesReady callback) {
            fetchCatalog(catalog -> callback.ready(recognition
                ? AssistantSpeechCapabilities.parseRecognition(catalog, sttModel)
                : AssistantSpeechCapabilities.parseSynthesis(catalog, ttsModel, voice)));
        }
        final synchronized void fetchCatalog(CatalogReady callback) {
            if (ended) return;
            timer(45000, "speech_discovery_timeout");
            call = http.newCall(request("/audio/capabilities").header("Accept", "application/json").get().build());
            call.enqueue(new Callback() {
                @Override public void onFailure(Call request, IOException error) { fail("speech_discovery_unavailable"); }
                @Override public void onResponse(Call request, Response response) {
                    try (Response owned = response) {
                        if (response.code() != 200) { fail(httpError(response.code())); return; }
                        ResponseBody body = response.body();
                        if (body == null || body.contentLength() > CATALOG_LIMIT) { fail("speech_discovery_invalid"); return; }
                        byte[] bytes = readBounded(body.byteStream(), CATALOG_LIMIT);
                        String text = new String(bytes, StandardCharsets.UTF_8); boundedDepth(text);
                        JSONObject catalog = AssistantSpeechCapabilities.discovery(new JSONObject(text));
                        if (!"list".equals(catalog.optString("object")) || catalog.optJSONArray("data") == null || catalog.optJSONArray("data").length() > 1000)
                            throw AssistantSpeechCapabilities.unsupported();
                        synchronized (Work.this) { if (!ended) { clearTimer(); callback.ready(catalog); } }
                    } catch (Exception invalid) { fail("speech_server_configuration_unsupported"); }
                }
            });
        }
    }
    private final class Discovery extends Work {
        private final DiscoveryListener listener;
        Discovery(DiscoveryListener listener) { this.listener = listener; }
        @Override void failed(String safeMessage) { listener.failed(safeMessage); }
    }
    private final class Speech extends Work implements Callback {
        private final SpeechListener listener;
        private List<String> chunks;
        private int index;
        private AssistantSpeechPcmSpool spool;
        Speech(SpeechListener listener) { this.listener = listener; }
        synchronized void start(String text, int maximum) {
            if (ended) return;
            chunks = splitText(text, maximum); next();
        }
        synchronized void next() {
            if (ended) return;
            timer(SYNTHESIS_REQUEST_MS, "speech_timeout");
            byte[] bytes = AssistantSpeechCapabilities.object("model", ttsModel, "voice", voice,
                "input", chunks.get(index++), "response_format", "pcm").toString().getBytes(StandardCharsets.UTF_8);
            // One-shot requests prohibit transparent replays after ambiguous synthesis failures.
            RequestBody body = new RequestBody() {
                @Override public MediaType contentType() { return MediaType.get("application/json"); }
                @Override public long contentLength() { return bytes.length; }
                @Override public boolean isOneShot() { return true; }
                @Override public void writeTo(BufferedSink sink) throws IOException { sink.write(bytes); }
            };
            call = synthesisHttp.newCall(request("/audio/speech").post(body).build()); call.enqueue(this);
        }
        @Override public void onFailure(Call request, IOException error) { fail("speech_network_error"); }
        @Override public void onResponse(Call request, Response response) {
            try (Response owned = response) {
                if (response.code() != 200) { fail(httpError(response.code())); return; }
                ResponseBody body = response.body();
                if (body == null || !validPcm(body.contentType()) || body.contentLength() > SPEECH_BYTES) { fail("speech_invalid_pcm_stream"); return; }
                body.source().timeout().timeout(30, TimeUnit.SECONDS);
                final AssistantSpeechPcmSpool current;
                synchronized (this) {
                    if (ended) return;
                    spool = current = new AssistantSpeechPcmSpool(cacheDirectory, SPEECH_BYTES);
                    playbackReaders.execute(() -> play(current));
                }
                long partBytes = 0; int pending = -1;
                try (InputStream stream = body.byteStream()) {
                    byte[] buffer = new byte[8192];
                    for (int count; (count = stream.read(buffer, pending < 0 ? 0 : 1, pending < 0 ? buffer.length : buffer.length - 1)) != -1;) {
                        if (count == 0) continue;
                        partBytes += count;
                        synchronized (this) {
                            if (ended) return;
                            if (partBytes > SPEECH_BYTES) { fail("speech_duration_limit"); return; }
                        }
                        if (pending >= 0) { buffer[0] = (byte) pending; count++; }
                        int aligned = count & ~1;
                        pending = count == aligned ? -1 : buffer[count - 1] & 255;
                        if (aligned > 0) current.append(buffer, aligned);
                    }
                }
                synchronized (this) {
                    if (ended) return;
                    if (pending >= 0 || partBytes == 0) { fail("speech_invalid_pcm_stream"); return; }
                    current.complete();
                }
            } catch (IOException invalid) { fail("speech_network_error"); }
        }
        private void play(AssistantSpeechPcmSpool current) {
            try {
                for (byte[] pcm; (pcm = current.read()) != null;) {
                    synchronized (this) { if (ended) return; }
                    // AudioTrack may block here, independently of the HTTP producer and its queue slot.
                    listener.pcm(pcm, AssistantSpeechCapabilities.SAMPLE_RATE);
                }
                synchronized (this) {
                    if (ended) return;
                    current.close(); spool = null;
                    if (index < chunks.size()) next();
                    else if (finish()) listener.completed();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                fail("speech_playback_interrupted");
            } catch (IOException | RuntimeException failed) { fail("speech_playback_failed"); }
            finally { current.close(); }
        }
        @Override void stop() { super.stop(); if (spool != null) spool.close(); }
        @Override void failed(String safeMessage) { listener.failed(safeMessage); }
    }
    private final class Recording extends Work implements Recognition {
        private final RecognitionListener listener;
        private AssistantSpeechCapabilities caps;
        private WebSocket socket;
        private String sessionId, itemId;
        private boolean ready, committed;
        private long bytes, openedAt, lastSentAt, resultDeadline, sequence;
        Recording(RecognitionListener listener) { this.listener = listener; }
        synchronized void start(AssistantSpeechCapabilities capabilities) {
            if (ended) return;
            caps = capabilities; openedAt = now(); lastSentAt = openedAt;
            timer(Math.min(20000, Math.min(caps.maxSessionMs, caps.idleTimeoutMs)), "recognition_handshake_timeout");
            socket = sockets.newWebSocket(request("/realtime?intent=transcription").build(), new WebSocketListener() {
                @Override public void onOpen(WebSocket ws, Response response) {
                    synchronized (Recording.this) {
                        if (ended) { ws.cancel(); return; }
                        socket = ws;
                        send(AssistantSpeechCapabilities.object("type", "session.update", "event_id", eventId(),
                            "session", AssistantSpeechCapabilities.object("type", "transcription", "audio",
                                AssistantSpeechCapabilities.object("input", AssistantSpeechCapabilities.object(
                                    "format", AssistantSpeechCapabilities.object("type", "audio/pcm", "rate", 24000),
                                    "transcription", AssistantSpeechCapabilities.object("model", sttModel),
                                    "turn_detection", null, "noise_reduction", null)))));
                    }
                }
                @Override public void onMessage(WebSocket ws, String text) { receive(text); }
                @Override public void onMessage(WebSocket ws, ByteString bytes) { fail("recognition_unexpected_binary"); }
                @Override public void onClosing(WebSocket ws, int code, String reason) { ws.close(1000, null); fail("recognition_disconnected"); }
                @Override public void onClosed(WebSocket ws, int code, String reason) { fail("recognition_disconnected"); }
                @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                    fail(response == null ? "recognition_network_error" : httpError(response.code()));
                }
            });
        }
        @Override public synchronized long maxBufferBytes() { return ready ? Math.min(UTTERANCE_BYTES, caps.maxBufferBytes) : 0; }
        @Override public synchronized boolean append(byte[] pcm) {
            if (ended || !ready || committed) return false;
            if (!live()) return false;
            if (pcm == null || pcm.length == 0 || pcm.length > 48000 || (pcm.length & 1) != 0) { fail("recognition_invalid_pcm"); return false; }
            if (bytes + pcm.length > maxBufferBytes()) { fail("recognition_buffer_limit"); return false; }
            for (int offset = 0; offset < pcm.length; offset += AssistantSpeechCapabilities.PACKET_BYTES) {
                byte[] packet = Arrays.copyOfRange(pcm, offset, Math.min(pcm.length, offset + AssistantSpeechCapabilities.PACKET_BYTES));
                if (!send(AssistantSpeechCapabilities.object("type", "input_audio_buffer.append", "event_id", eventId(), "audio", ByteString.of(packet).base64()))) return false;
                bytes += packet.length;
            }
            watch(); return true;
        }
        @Override public synchronized void commit() {
            if (ended) return;
            if (!ready || committed || bytes < AssistantSpeechCapabilities.PACKET_BYTES) { fail("recognition_invalid_commit"); return; }
            if (!live()) return;
            if (send(AssistantSpeechCapabilities.object("type", "input_audio_buffer.commit", "event_id", eventId()))) {
                committed = true; resultDeadline = now() + RESULT_MS; watch();
            }
        }
        private String eventId() { return "assistant_speech_" + (++sequence); }
        private boolean ownsEvent(String id) {
            if (!id.startsWith("assistant_speech_")) return false;
            try { long number = Long.parseLong(id.substring("assistant_speech_".length())); return number > 0 && number <= sequence; }
            catch (NumberFormatException invalid) { return false; }
        }
        private boolean send(JSONObject event) {
            if (!live()) return false;
            String text = event.toString(); int length = text.getBytes(StandardCharsets.UTF_8).length;
            if (length > caps.maxMessageBytes) { fail("speech_server_configuration_unsupported"); return false; }
            if (socket == null || socket.queueSize() + length > QUEUE_LIMIT) { fail("recognition_transport_overflow"); return false; }
            if (!socket.send(text)) { fail("recognition_network_error"); return false; }
            lastSentAt = now(); return true;
        }
        private boolean live() {
            if (ended) return false;
            long current = now();
            if (current - openedAt >= caps.maxSessionMs) { fail("recognition_session_expired"); return false; }
            if (!committed && current - lastSentAt >= caps.idleTimeoutMs) { fail("recognition_idle_timeout"); return false; }
            if (committed && current >= resultDeadline) { fail("recognition_result_timeout"); return false; }
            return true;
        }
        private void watch() {
            long current = now();
            long delay = caps.maxSessionMs - (current - openedAt);
            if (!committed) delay = Math.min(delay, caps.idleTimeoutMs - (current - lastSentAt));
            if (committed) delay = Math.min(delay, resultDeadline - current);
            timer(delay, committed && resultDeadline - current <= delay ? "recognition_result_timeout" :
                caps.maxSessionMs - (current - openedAt) <= delay ? "recognition_session_expired" : "recognition_idle_timeout");
        }
        private synchronized void receive(String text) {
            if (!live()) return;
            if (text.length() > EVENT_LIMIT || text.getBytes(StandardCharsets.UTF_8).length > Math.min(EVENT_LIMIT, caps.maxOutputBytes)) {
                fail("recognition_message_limit"); return;
            }
            try {
                boundedDepth(text); JSONObject event = new JSONObject(text);
                String type = AssistantSpeechCapabilities.identifier(event, "type");
                switch (type) {
                    case "session.created": {
                        JSONObject session = event.getJSONObject("session");
                        if (sessionId != null || !"transcription".equals(session.optString("type"))) throw AssistantSpeechCapabilities.unsupported();
                        sessionId = AssistantSpeechCapabilities.identifier(session, "id"); break;
                    }
                    case "session.updated": {
                        JSONObject session = event.getJSONObject("session");
                        JSONObject input = session.getJSONObject("audio").getJSONObject("input");
                        JSONObject format = input.getJSONObject("format");
                        if (sessionId == null || !sessionId.equals(session.optString("id")) || !"transcription".equals(session.optString("type")) ||
                            !"audio/pcm".equals(format.optString("type")) || AssistantSpeechCapabilities.integer(format, "rate", 24000, 24000) != 24000 ||
                            !sttModel.equals(input.getJSONObject("transcription").optString("model")) || !input.has("turn_detection") || !input.isNull("turn_detection"))
                            throw AssistantSpeechCapabilities.unsupported();
                        if (!ready) {
                            // Reserve microphone arming, one bounded utterance, and the result deadline.
                            if (caps.maxSessionMs - (now() - openedAt) < AssistantSpeechCapabilities.READY_SESSION_RESERVE_MS) { fail("recognition_session_timing_unsupported"); return; }
                            ready = true; watch(); listener.ready();
                        } break;
                    }
                    case "input_audio_buffer.committed": {
                        if (!committed || itemId != null || !event.has("previous_item_id") || !event.isNull("previous_item_id")) throw AssistantSpeechCapabilities.unsupported();
                        itemId = AssistantSpeechCapabilities.identifier(event, "item_id"); break;
                    }
                    case "conversation.item.input_audio_transcription.completed": {
                        if (itemId == null || !itemId.equals(event.optString("item_id"))) break;
                        AssistantSpeechCapabilities.integer(event, "content_index", 0, 0);
                        Object transcript = event.opt("transcript");
                        if (!(transcript instanceof String) || ((String) transcript).length() > 65536) throw AssistantSpeechCapabilities.unsupported();
                        if (finish()) { stop(); listener.completed((String) transcript, (int) (bytes * 1000 / 48000)); } break;
                    }
                    case "conversation.item.input_audio_transcription.failed":
                        if (itemId != null && itemId.equals(event.optString("item_id"))) fail("recognition_provider_error"); break;
                    case "error": {
                        JSONObject error = event.optJSONObject("error");
                        String related = error == null ? null : error.optString("event_id", null);
                        if (related == null || ownsEvent(related)) fail("recognition_provider_error"); break;
                    }
                    default: break;
                }
            } catch (Exception invalid) { fail("recognition_protocol_error"); }
        }
        @Override void stop() { super.stop(); if (socket != null) socket.cancel(); }
        @Override void failed(String safeMessage) { listener.failed(safeMessage); }
    }
    static List<String> splitText(String text, int maximum) {
        if (maximum < 2) throw AssistantSpeechCapabilities.unsupported();
        List<String> chunks = new ArrayList<>();
        for (int start = 0; start < text.length();) {
            int end = Math.min(text.length(), start + maximum);
            if (end < text.length()) {
                if (Character.isHighSurrogate(text.charAt(end - 1)) && Character.isLowSurrogate(text.charAt(end))) end--;
                int preferred = end;
                for (int i = end - 1; i >= start + (end - start) / 2; i--) {
                    if (Character.isWhitespace(text.charAt(i))) { preferred = i + 1; break; }
                }
                end = preferred;
            }
            String chunk = text.substring(start, end);
            if (!chunk.trim().isEmpty()) chunks.add(chunk);
            start = end;
        }
        return chunks;
    }
    private long now() { return clock.nowMs(); }
    private static boolean validPcm(MediaType type) {
        return type != null && "audio".equals(type.type()) && "pcm".equals(type.subtype()) &&
            "24000".equals(type.parameter("rate")) && "1".equals(type.parameter("channels")) && "s16le".equals(type.parameter("format"));
    }
    private static String httpError(int status) {
        return status == 401 || status == 403 ? "speech_authentication_failed" :
            status == 404 ? "speech_server_configuration_unsupported" : status == 429 ? "speech_rate_limited" : "speech_service_unavailable";
    }
    private static byte[] readBounded(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] chunk = new byte[8192];
        for (int count; (count = input.read(chunk)) != -1;) {
            if (output.size() + count > limit) throw new IOException();
            output.write(chunk, 0, count);
        }
        return output.toByteArray();
    }
    private static void boundedDepth(String text) {
        int depth = 0; boolean quoted = false, escaped = false;
        for (int i = 0; i < text.length(); i++) {
            char value = text.charAt(i);
            if (quoted) {
                if (escaped) escaped = false;
                else if (value == '\\') escaped = true;
                else if (value == '"') quoted = false;
            } else if (value == '"') quoted = true;
            else if ((value == '{' || value == '[') && ++depth > 32) throw AssistantSpeechCapabilities.unsupported();
            else if (value == '}' || value == ']') depth--;
        }
    }
}
