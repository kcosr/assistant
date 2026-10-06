package com.assistant.mobile.voice;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okio.Buffer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AssistantSpeechClientTest {
    static JSONObject object(Object... values) { return AssistantSpeechCapabilities.object(values); }
    static JSONObject listing(long maxBuffer, int maxText) {
        JSONObject limits = object("max_buffer_bytes", maxBuffer, "max_message_bytes", 65536, "max_output_bytes", 1048576,
            "idle_timeout_seconds", 60, "max_session_seconds", 3600);
        return object("object", "list", "data", new JSONArray()
            .put(object("id", "asr", "task", "transcription", "ready", true, "realtime", limits))
            .put(object("id", "tts", "task", "speech", "ready", true, "voices", new JSONArray().put(object("id", "voice")),
                "output_formats", new JSONArray().put(object("id", "pcm", "encoding", "pcm_s16le")),
                "audio", object("sample_rate", 24000, "channels", 1), "max_text_length", maxText, "streams", true)));
    }
    static MockResponse capabilities(long buffer, int text) { return new MockResponse().setBody(listing(buffer, text).toString()).setHeader("Content-Type", "application/json"); }
    static AssistantSpeechClient client(MockWebServer server) { return new AssistantSpeechClient(server.url("/speech/v1").toString(), "secret-token", "asr", "tts", "voice"); }
    static final class RecognitionEvents implements AssistantSpeechClient.RecognitionListener {
        final BlockingQueue<String> events = new LinkedBlockingQueue<>();
        public void ready() { events.add("ready"); }
        public void completed(String text, int duration) { events.add("done:" + text + ":" + duration); }
        public void failed(String safe) { events.add("failed:" + safe); }
    }
    static final class SpeechEvents implements AssistantSpeechClient.SpeechListener {
        final BlockingQueue<String> events = new LinkedBlockingQueue<>();
        final List<byte[]> packets = new ArrayList<>();
        public void pcm(byte[] pcm, int rate) { assertEquals(24000, rate); assertEquals(0, pcm.length & 1); packets.add(pcm); }
        public void completed() { events.add("done"); }
        public void failed(String safe) { events.add("failed:" + safe); }
    }
    static final class Wire extends WebSocketListener {
        final BlockingQueue<JSONObject> messages = new LinkedBlockingQueue<>();
        final boolean acknowledge;
        WebSocket socket;
        Wire(boolean acknowledge) { this.acknowledge = acknowledge; }
        @Override public void onOpen(WebSocket ws, Response response) {
            socket = ws;
            ws.send(object("type", "session.created", "session", object("id", "session-a", "type", "transcription")).toString());
        }
        @Override public void onMessage(WebSocket ws, String text) {
            try {
                JSONObject event = new JSONObject(text); messages.add(event);
                if (acknowledge && "session.update".equals(event.optString("type"))) {
                    JSONObject session = event.getJSONObject("session"); AssistantSpeechCapabilities.put(session, "id", "session-a");
                    ws.send(object("type", "session.updated", "session", session).toString());
                }
            } catch (Exception invalid) { throw new AssertionError(invalid); }
        }
        void completed(String item, String text) {
            socket.send(object("type", "conversation.item.input_audio_transcription.completed", "item_id", item,
                "content_index", 0, "transcript", text).toString());
        }
    }

    @Test public void discoveryIsAuthenticatedAndKeepsChoicesWhenSelectionIsInvalid() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            JSONObject raw = listing(2880000, 20); AssistantSpeechCapabilities.put(raw.getJSONArray("data").getJSONObject(0), "provider_config", object("secret", "must-not-leak"));
            server.enqueue(new MockResponse().setBody(raw.toString()));
            BlockingQueue<Object> result = new LinkedBlockingQueue<>();
            try (AssistantSpeechClient speech = new AssistantSpeechClient(server.url("/speech/v1/").toString(), "secret-token", "missing", "missing", "missing")) {
                speech.discover(new AssistantSpeechClient.DiscoveryListener() {
                    public void ready(JSONObject catalog) { result.add(catalog); }
                    public void failed(String error) { result.add(error); }
                });
                Object value = result.poll(5, TimeUnit.SECONDS); assertTrue(value instanceof JSONObject);
                assertFalse(value.toString().contains("must-not-leak"));
                RecordedRequest request = server.takeRequest(5, TimeUnit.SECONDS);
                assertEquals("/speech/v1/audio/capabilities", request.getPath()); assertEquals("Bearer secret-token", request.getHeader("Authorization"));
            }
        }
    }
    @Test public void redirectAndAuthenticationErrorsNeverFollowOrExposeBodies() throws Exception {
        for (int status : new int[] {302, 401}) try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            server.enqueue(new MockResponse().setResponseCode(status).setHeader("Location", "/leak").setBody("secret-token private-provider-details"));
            BlockingQueue<String> result = new LinkedBlockingQueue<>();
            speech.discover(new AssistantSpeechClient.DiscoveryListener() {
                public void ready(JSONObject catalog) { result.add("unexpected"); }
                public void failed(String error) { result.add(error); }
            });
            assertEquals(status == 401 ? "speech_authentication_failed" : "speech_service_unavailable", result.poll(5, TimeUnit.SECONDS));
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS)); assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS));
        }
    }
    @Test public void synthesisSplitsAtFreshServerLimitAndStreamsAlignedPcmOnce() throws Exception {
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            server.enqueue(capabilities(2880000, 6));
            server.enqueue(new MockResponse().setHeader("Content-Type", "audio/pcm; rate=24000; channels=1; format=s16le")
                .setChunkedBody(new Buffer().write(new byte[]{1,2,3,4}), 1));
            server.enqueue(new MockResponse().setHeader("Content-Type", "audio/pcm; rate=24000; channels=1; format=s16le")
                .setBody(new Buffer().write(new byte[]{5,6})));
            SpeechEvents events = new SpeechEvents(); speech.speak("hello world", events);
            assertEquals("done", events.events.poll(5, TimeUnit.SECONDS));
            assertEquals("/speech/v1/audio/capabilities", server.takeRequest().getPath());
            JSONObject first = new JSONObject(server.takeRequest().getBody().readUtf8()), second = new JSONObject(server.takeRequest().getBody().readUtf8());
            assertEquals("hello ", first.getString("input")); assertEquals("world", second.getString("input"));
            assertEquals("pcm", first.getString("response_format"));
            int bytes = 0; for (byte[] chunk : events.packets) bytes += chunk.length; assertEquals(6, bytes);
            assertNull(events.events.poll(100, TimeUnit.MILLISECONDS));
        }
    }
    @Test public void recognitionWaitsForUpdatedSessionCorrelatesCommitAndReportsDuration() throws Exception {
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            Wire wire = new Wire(true); server.enqueue(capabilities(2880000, 20)); server.enqueue(new MockResponse().withWebSocketUpgrade(wire));
            RecognitionEvents events = new RecognitionEvents(); AssistantSpeechClient.Recognition recording = speech.recognize(events);
            assertEquals("ready", events.events.poll(5, TimeUnit.SECONDS));
            JSONObject update = wire.messages.poll(5, TimeUnit.SECONDS);
            assertTrue(update.getJSONObject("session").getJSONObject("audio").getJSONObject("input").isNull("turn_detection"));
            assertEquals(2880000, recording.maxBufferBytes()); assertTrue(recording.append(new byte[4800])); recording.commit();
            JSONObject append = wire.messages.poll(5, TimeUnit.SECONDS); assertEquals("input_audio_buffer.append", append.getString("type"));
            assertEquals(4800, okio.ByteString.decodeBase64(append.getString("audio")).size());
            assertEquals("input_audio_buffer.commit", wire.messages.poll(5, TimeUnit.SECONDS).getString("type"));
            wire.completed("unrelated", "wrong");
            wire.socket.send(object("type", "input_audio_buffer.committed", "item_id", "item-a", "previous_item_id", null).toString());
            wire.completed("item-a", "hello");
            assertEquals("done:hello:100", events.events.poll(5, TimeUnit.SECONDS)); assertFalse(recording.append(new byte[4800]));
            RecordedRequest preflight = server.takeRequest(), upgrade = server.takeRequest();
            assertEquals("/speech/v1/audio/capabilities", preflight.getPath()); assertEquals("/speech/v1/realtime?intent=transcription", upgrade.getPath());
            assertEquals("Bearer secret-token", upgrade.getHeader("Authorization"));
        }
    }
    @Test public void socketOpenAndSessionCreatedDoNotAuthorizeMicrophone() throws Exception {
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            Wire wire = new Wire(false); server.enqueue(capabilities(2880000, 20)); server.enqueue(new MockResponse().withWebSocketUpgrade(wire));
            RecognitionEvents events = new RecognitionEvents(); AssistantSpeechClient.Recognition recording = speech.recognize(events);
            assertNotNull(wire.messages.poll(5, TimeUnit.SECONDS));
            assertFalse(recording.append(new byte[4800])); assertEquals(0, recording.maxBufferBytes());
            assertNull(events.events.poll(100, TimeUnit.MILLISECONDS)); recording.cancel();
            assertNull(events.events.poll(100, TimeUnit.MILLISECONDS));
        }
    }
    @Test public void eachRecordingUsesFreshLimitsAndBufferOverflowFailsClosed() throws Exception {
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            for (long maximum : new long[]{9600,4800}) {
                Wire wire = new Wire(true); server.enqueue(capabilities(maximum, 20)); server.enqueue(new MockResponse().withWebSocketUpgrade(wire));
                RecognitionEvents events = new RecognitionEvents(); AssistantSpeechClient.Recognition recording = speech.recognize(events);
                assertEquals("ready", events.events.poll(5, TimeUnit.SECONDS)); assertEquals(maximum, recording.maxBufferBytes());
                assertTrue(recording.append(new byte[(int) maximum])); assertFalse(recording.append(new byte[2]));
                assertEquals("failed:recognition_buffer_limit", events.events.poll(5, TimeUnit.SECONDS));
            }
            assertEquals(4, server.getRequestCount());
        }
    }
    @Test public void expiredSessionIsDetectedUsingInjectedSuspendAwareClock() throws Exception {
        AtomicLong clock = new AtomicLong(1000);
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = new AssistantSpeechClient(server.url("/v1").toString(), "secret-token", "asr", "tts", "voice", clock::get)) {
            server.enqueue(capabilities(2880000, 20)); server.enqueue(new MockResponse().withWebSocketUpgrade(new Wire(true)));
            RecognitionEvents events = new RecognitionEvents(); AssistantSpeechClient.Recognition recording = speech.recognize(events);
            assertEquals("ready", events.events.poll(5, TimeUnit.SECONDS)); clock.addAndGet(3600001);
            assertFalse(recording.append(new byte[4800])); assertEquals("failed:recognition_session_expired", events.events.poll(5, TimeUnit.SECONDS));
        }
    }
    @Test public void cancellingBlockedPlaybackDoesNotWaitForCallbackMonitor() throws Exception {
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            server.enqueue(capabilities(2880000, 20)); server.enqueue(new MockResponse().setHeader("Content-Type", "audio/pcm; rate=24000; channels=1; format=s16le")
                .setBody(new Buffer().write(new byte[]{1,2})));
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            BlockingQueue<String> terminal = new LinkedBlockingQueue<>();
            AssistantSpeechClient.Operation work = speech.speak("hello", new AssistantSpeechClient.SpeechListener() {
                public void pcm(byte[] chunk, int rate) { entered.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException error) { Thread.currentThread().interrupt(); } }
                public void completed() { terminal.add("done"); }
                public void failed(String safe) { terminal.add(safe); }
            });
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            long start = System.nanoTime(); work.cancel(); assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 500);
            release.countDown(); assertNull(terminal.poll(200, TimeUnit.MILLISECONDS));
        }
    }
    @Test public void httpResponseDrainsWhilePlaybackIsBlocked() throws Exception {
        byte[] audio = new byte[2 * 1024 * 1024];
        CountDownLatch received = new CountDownLatch(1), entered = new CountDownLatch(1), release = new CountDownLatch(1);
        okhttp3.OkHttpClient network = new okhttp3.OkHttpClient.Builder().eventListener(new okhttp3.EventListener() {
            @Override public void responseBodyEnd(okhttp3.Call call, long count) {
                if (count == audio.length) received.countDown();
            }
        }).build();
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = new AssistantSpeechClient(
            server.url("/speech/v1").toString(), "secret-token", "asr", "tts", "voice", network, () -> System.nanoTime()/1000000)) {
            server.enqueue(capabilities(2880000, 20));
            server.enqueue(new MockResponse().setHeader("Content-Type", "audio/pcm; rate=24000; channels=1; format=s16le")
                .setBody(new Buffer().write(audio)));
            AssistantSpeechClient.Operation work = speech.speak("hello", new AssistantSpeechClient.SpeechListener() {
                public void pcm(byte[] bytes, int rate) { entered.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException error) { Thread.currentThread().interrupt(); } }
                public void completed() { }
                public void failed(String error) { }
            });
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                assertTrue("HTTP reader must not wait for AudioTrack capacity", received.await(3, TimeUnit.SECONDS));
                work.cancel();
            } finally { release.countDown(); }
        }
    }

    @Test public void pcmLimitAppliesPerSynthesisRequestRatherThanAcrossLongText() throws Exception {
        byte[] audio = new byte[15000000];
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            server.enqueue(capabilities(2880000, 6));
            for (int i = 0; i < 2; i++) server.enqueue(new MockResponse()
                .setHeader("Content-Type", "audio/pcm; rate=24000; channels=1; format=s16le").setBody(new Buffer().write(audio)));
            java.util.concurrent.atomic.AtomicLong played = new java.util.concurrent.atomic.AtomicLong();
            BlockingQueue<String> done = new LinkedBlockingQueue<>();
            speech.speak("hello world", new AssistantSpeechClient.SpeechListener() {
                public void pcm(byte[] bytes, int rate) { played.addAndGet(bytes.length); }
                public void completed() { done.add("done"); }
                public void failed(String error) { done.add(error); }
            });
            assertEquals("done", done.poll(15, TimeUnit.SECONDS));
            assertEquals(30000000, played.get());
        }
    }

    @Test public void speechAndRecognitionDoNotRequireTheOtherModel() throws Exception {
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = client(server)) {
            JSONObject synthesisOnly = listing(2880000, 20);
            synthesisOnly.getJSONArray("data").remove(0);
            server.enqueue(new MockResponse().setBody(synthesisOnly.toString()));
            server.enqueue(new MockResponse().setHeader("Content-Type", "audio/pcm; rate=24000; channels=1; format=s16le")
                .setBody(new Buffer().write(new byte[]{1,2})));
            SpeechEvents spoken = new SpeechEvents(); speech.speak("hello", spoken);
            assertEquals("done", spoken.events.poll(5, TimeUnit.SECONDS));
            JSONObject recognitionOnly = listing(2880000, 20);
            recognitionOnly.getJSONArray("data").getJSONObject(1).put("ready", false);
            server.enqueue(new MockResponse().setBody(recognitionOnly.toString()));
            server.enqueue(new MockResponse().withWebSocketUpgrade(new Wire(true)));
            RecognitionEvents heard = new RecognitionEvents();
            AssistantSpeechClient.Recognition recording = speech.recognize(heard);
            assertEquals("ready", heard.events.poll(5, TimeUnit.SECONDS));
            recording.cancel();
        }
    }

    @Test public void committedRecognitionAllowsQueueAndInferenceWaitButStillTimesOut() throws Exception {
        AtomicLong clock = new AtomicLong(1000);
        try (MockWebServer server = new MockWebServer(); AssistantSpeechClient speech = new AssistantSpeechClient(
            server.url("/speech/v1").toString(), "secret-token", "asr", "tts", "voice", clock::get)) {
            for (boolean expired : new boolean[]{false, true}) {
                Wire wire = new Wire(true);
                server.enqueue(capabilities(2880000, 20)); server.enqueue(new MockResponse().withWebSocketUpgrade(wire));
                RecognitionEvents events = new RecognitionEvents(); AssistantSpeechClient.Recognition recording = speech.recognize(events);
                assertEquals("ready", events.events.poll(5, TimeUnit.SECONDS));
                assertTrue(recording.append(new byte[4800])); recording.commit();
                while (!"input_audio_buffer.commit".equals(wire.messages.poll(5, TimeUnit.SECONDS).getString("type"))) { }
                clock.addAndGet(expired ? 240001 : 60000);
                wire.socket.send(object("type", "input_audio_buffer.committed", "item_id", "item-a", "previous_item_id", null).toString());
                if (!expired) wire.completed("item-a", "hello");
                assertEquals(expired ? "failed:recognition_result_timeout" : "done:hello:100", events.events.poll(5, TimeUnit.SECONDS));
            }
        }
    }

    @Test public void textSplittingPreservesUnicodeAndBoundsEveryRequest() {
        String text = "abcd\uD83D\uDE00xyz more"; List<String> chunks = AssistantSpeechClient.splitText(text, 5);
        assertEquals(text, String.join("", chunks));
        for (String chunk : chunks) { assertTrue(chunk.length() <= 5); assertFalse(Character.isHighSurrogate(chunk.charAt(chunk.length()-1))); }
    }
    @Test public void obsoleteOrIncompatibleCapabilitiesFailBeforeMicrophoneOrSynthesis() throws Exception {
        JSONObject old = listing(2880000, 20); old.getJSONArray("data").getJSONObject(0).remove("realtime");
        assertThrows(IllegalArgumentException.class, () -> AssistantSpeechCapabilities.parseRecognition(old, "asr"));
        JSONObject stereo = listing(2880000, 20); stereo.getJSONArray("data").getJSONObject(1).getJSONObject("audio").put("channels", 2);
        assertThrows(IllegalArgumentException.class, () -> AssistantSpeechCapabilities.parseSynthesis(stereo, "tts", "voice"));
        JSONObject unavailable = listing(2880000,20); unavailable.getJSONArray("data").getJSONObject(0).put("ready", false);
        assertThrows(IllegalArgumentException.class, () -> AssistantSpeechCapabilities.parseRecognition(unavailable, "asr"));
        JSONObject shortLifetime = listing(2880000,20); shortLifetime.getJSONArray("data").getJSONObject(0).getJSONObject("realtime").put("max_session_seconds", 120);
        assertThrows(IllegalArgumentException.class, () -> AssistantSpeechCapabilities.parseRecognition(shortLifetime, "asr"));
    }
}
