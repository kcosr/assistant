package com.assistant.mobile.voice;

import android.content.Context;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import android.os.Build;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
public final class AssistantVoiceEventLogTest {
    @After
    public void cleanup() {
        Context context = RuntimeEnvironment.getApplication();
        File logFile = new File(context.getFilesDir(), AssistantVoiceEventLog.FILE_NAME);
        if (logFile.isFile()) {
            //noinspection ResultOfMethodCallIgnored
            logFile.delete();
        }
    }

    @Test
    public void recordWritesJsonLineToAppPrivateLog() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", "session-1");
        AssistantVoiceEventLog.put(details, "action", "start_manual_listen");

        AssistantVoiceEventLog.record(context, "plugin_start_manual_listen", details);

        File logFile = new File(context.getFilesDir(), AssistantVoiceEventLog.FILE_NAME);
        assertTrue(logFile.isFile());

        String content = new String(Files.readAllBytes(logFile.toPath()), StandardCharsets.UTF_8);
        assertTrue(content.contains("\"tsIso\":\""));
        assertTrue(content.contains("\"event\":\"plugin_start_manual_listen\""));
        assertTrue(content.contains("\"sessionId\":\"session-1\""));
        assertTrue(content.endsWith("\n"));
    }

    @Test
    public void appendLineTrimsOldestEntriesAtLineBoundary() throws Exception {
        File logFile = File.createTempFile("assistant-voice-event-log", ".txt");
        String oldOne = "{\"event\":\"old-1\"}\n";
        String oldTwo = "{\"event\":\"old-2\"}\n";
        String latest = "{\"event\":\"latest\"}\n";

        AssistantVoiceEventLog.appendLine(logFile, oldOne, 48, 24);
        AssistantVoiceEventLog.appendLine(logFile, oldTwo, 48, 24);
        AssistantVoiceEventLog.appendLine(logFile, latest, 48, 24);

        String content = new String(Files.readAllBytes(logFile.toPath()), StandardCharsets.UTF_8);
        assertFalse(content.contains("\"event\":\"old-1\""));
        assertTrue(content.contains("\"event\":\"latest\""));

        //noinspection ResultOfMethodCallIgnored
        logFile.delete();
    }
}
