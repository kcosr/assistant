package com.assistant.mobile.voice;

import static org.junit.Assert.*;

import android.os.Build;
import android.system.ErrnoException;
import android.system.OsConstants;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;

import javax.crypto.spec.SecretKeySpec;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadows.ShadowPosix;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N, shadows = AssistantSpeechCredentialStoreTest.MissingAwarePosix.class)
public final class AssistantSpeechCredentialStoreTest {
    /** Robolectric's legacy Posix lstat returns a dummy stat for absent files; enforce real ENOENT. */
    @Implements(className = "libcore.io.Posix", isInAndroidSdk = false)
    public static class MissingAwarePosix extends ShadowPosix {
        @Implementation protected static Object lstat(String path) throws ErrnoException {
            try {
                Files.readAttributes(new File(path).toPath(), java.nio.file.attribute.BasicFileAttributes.class,
                    java.nio.file.LinkOption.NOFOLLOW_LINKS);
                return ShadowPosix.stat(path);
            } catch (java.nio.file.NoSuchFileException absent) {
                throw new ErrnoException("lstat", OsConstants.ENOENT);
            } catch (java.io.IOException unavailable) {
                throw new ErrnoException("lstat", OsConstants.EIO);
            }
        }
    }

    private static final String ENDPOINT = "https://assistant/speech/v1";
    private static final String TOKEN = "private-speech-token";
    private final SecretKeySpec key = new SecretKeySpec(new byte[32], "AES");

    private AssistantSpeechCredentialStore store(File root, String profile) {
        return new AssistantSpeechCredentialStore(root, profile, () -> key);
    }

    @Test public void encryptsOutsidePreferencesAndBindsProfileAndEndpoint() throws Exception {
        File root = Files.createTempDirectory(RuntimeEnvironment.getApplication().getNoBackupFilesDir().toPath(), "binding-test").toFile();
        AssistantSpeechCredentialStore store = store(root, "com.assistant.dev\nhttps://assistant");
        store.set(ENDPOINT, TOKEN);
        assertEquals(TOKEN, store.get("HTTPS://ASSISTANT:443/speech/v1/"));
        assertNull(store.get("https://other/speech/v1"));
        assertNull(store.get("https://assistant/speech/V1"));
        assertNull(store.get("http://assistant/speech/v1"));
        assertNull(store(root, "com.assistant.prod\nhttps://assistant").get(ENDPOINT));
        assertNull(store(root, "com.assistant.dev\nhttps://another-backend").get(ENDPOINT));
        File[] files = new File(root, "speech-credentials").listFiles();
        assertNotNull(files);
        assertEquals(1, files.length);
        byte[] record = Files.readAllBytes(files[0].toPath());
        assertFalse(new String(record, StandardCharsets.UTF_8).contains(TOKEN));
        assertFalse(files[0].getName().contains("assistant"));
        store.remove(ENDPOINT);
        assertNull(store.get(ENDPOINT));
    }

    @Test public void copiedCiphertextCannotBeReboundToAnotherEndpoint() throws Exception {
        File root = Files.createTempDirectory(RuntimeEnvironment.getApplication().getNoBackupFilesDir().toPath(), "aad-test").toFile();
        AssistantSpeechCredentialStore store = store(root, "com.assistant\nhttps://assistant");
        store.set(ENDPOINT, TOKEN);
        File directory = new File(root, "speech-credentials");
        File original = directory.listFiles()[0];
        byte[] originalBytes = Files.readAllBytes(original.toPath());
        store.set("https://another/speech/v1", "different-token");
        File other = Arrays.stream(directory.listFiles()).filter(file -> !file.equals(original)).findFirst().get();
        Files.write(other.toPath(), originalBytes);
        try {
            store.get("https://another/speech/v1");
            fail("Copied ciphertext must fail authentication for another API root");
        } catch (javax.crypto.AEADBadTagException expected) { }
    }

    @Test public void corruptCredentialFailsClosedAndCanBeRemoved() throws Exception {
        File root = Files.createTempDirectory(RuntimeEnvironment.getApplication().getNoBackupFilesDir().toPath(), "corruption-test").toFile();
        AssistantSpeechCredentialStore store = store(root, "com.assistant\nhttps://assistant");
        store.set(ENDPOINT, TOKEN);
        File record = new File(root, "speech-credentials").listFiles()[0];
        Files.write(record.toPath(), new byte[] { 1, 2, 3 });
        try { store.get(ENDPOINT); fail("Corrupt credential must not appear unconfigured"); }
        catch (IllegalStateException expected) { assertFalse(expected.getMessage().contains(TOKEN)); }
        store.remove(ENDPOINT);
        assertNull(store.get(ENDPOINT));
    }

    @Test public void rejectsEndpointCredentialsQueriesFragmentsAndAmbiguousPaths() {
        for (String endpoint : new String[] { "https://token@assistant/speech/v1", "https://assistant/speech/v1?token=secret",
            "https://assistant/speech/v1#secret", "https://assistant/a/../speech/v1", "https://assistant/speech%2fv1", "wss://assistant/speech/v1", "" }) {
            try { AssistantSpeechCredentialStore.normalizeEndpoint(endpoint); fail("Accepted invalid API root"); }
            catch (IllegalArgumentException expected) { if (!endpoint.isEmpty()) assertFalse(expected.getMessage().contains(endpoint)); }
        }
    }

    @Test public void rejectsHeaderInjectionAndOversizedTokens() {
        for (String token : new String[] { "", "Bearer secret", "secret\r\nX-Header: value", " secret", "secret ", new String(new char[4097]).replace('\0', 'x') }) {
            try { AssistantSpeechCredentialStore.validateToken(token); fail("Accepted invalid token"); }
            catch (IllegalArgumentException expected) { assertFalse(expected.getMessage().contains("secret")); }
        }
    }
}
