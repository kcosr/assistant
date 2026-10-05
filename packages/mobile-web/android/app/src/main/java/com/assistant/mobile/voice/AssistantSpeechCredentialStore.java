package com.assistant.mobile.voice;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.AtomicFile;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Speech secrets are device-local, endpoint-bound, and never enter Assistant settings or the bridge. */
public final class AssistantSpeechCredentialStore {
    private static final Object LOCK = new Object();
    private static final String KEY_ALIAS = "assistant.speech-credentials.v1";
    private final File directory;
    private final String profile;
    private final KeyProvider keys;

    interface KeyProvider { SecretKey get() throws Exception; }

    public AssistantSpeechCredentialStore(Context context) {
        this(context.getNoBackupFilesDir(),
            context.getPackageName() + "\n" + AssistantVoiceConfig.load(context).assistantBaseUrl,
            AssistantSpeechCredentialStore::key);
    }

    AssistantSpeechCredentialStore(File noBackupDirectory, String profile, KeyProvider keys) {
        this.directory = new File(noBackupDirectory, "speech-credentials");
        if (profile == null || profile.isEmpty()) throw new IllegalArgumentException("Speech profile is required.");
        this.profile = profile;
        this.keys = keys;
    }

    public static String normalizeEndpoint(String endpoint) {
        try {
            if (endpoint == null || endpoint.length() > 2048) throw new IllegalArgumentException();
            URI uri = new URI(endpoint.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!(scheme.equals("https") || scheme.equals("http")) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                throw new IllegalArgumentException();
            }
            String path = uri.getRawPath() == null ? "" : uri.getRawPath();
            if (!path.matches("[/A-Za-z0-9._~-]*")) throw new IllegalArgumentException();
            for (String segment : path.split("/", -1)) {
                if (segment.equals(".") || segment.equals("..")) throw new IllegalArgumentException();
            }
            while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
            int port = uri.getPort();
            if (port < -1 || port > 65535 || port == 0) throw new IllegalArgumentException();
            if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
            return new URI(scheme, null, uri.getHost().toLowerCase(Locale.ROOT), port, path, null, null).toASCIIString();
        } catch (Exception error) {
            throw new IllegalArgumentException("Speech endpoint must be an HTTP or HTTPS API root without credentials, query, or fragment.");
        }
    }

    public static void validateToken(String token) {
        if (token == null || !token.matches("[\\x21-\\x7e]{1,4096}")) {
            throw new IllegalArgumentException("Enter a bearer token without whitespace.");
        }
    }

    private String binding(String endpoint) { return profile + "\nspeech\n" + normalizeEndpoint(endpoint); }

    private AtomicFile file(String binding) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(binding.getBytes(StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder();
        for (byte value : hash) name.append(String.format(Locale.ROOT, "%02x", value & 255));
        return new AtomicFile(new File(directory, name + ".enc"));
    }

    private static synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setUserAuthenticationRequired(false).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    public boolean isConfigured(String endpoint) throws Exception {
        synchronized (LOCK) {
            AtomicFile target = file(binding(endpoint));
            return !missing(target.getBaseFile()) || !missing(new File(target.getBaseFile().getPath() + ".bak"));
        }
    }

    public String get(String endpoint) throws Exception {
        synchronized (LOCK) {
            String binding = binding(endpoint);
            AtomicFile target = file(binding);
            byte[] encrypted;
            try { encrypted = target.readFully(); }
            catch (FileNotFoundException error) {
                if (missing(target.getBaseFile()) && missing(new File(target.getBaseFile().getPath() + ".bak"))) return null;
                throw new IllegalStateException("Speech credential storage is unavailable.");
            }
            if (encrypted.length < 30 || encrypted[0] != 1) throw new IllegalStateException("Saved speech credential is invalid. Remove and save it again.");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, keys.get(), new GCMParameterSpec(128, Arrays.copyOfRange(encrypted, 1, 13)));
            cipher.updateAAD(binding.getBytes(StandardCharsets.UTF_8));
            String token = new String(cipher.doFinal(encrypted, 13, encrypted.length - 13), StandardCharsets.UTF_8);
            validateToken(token);
            return token;
        }
    }

    public void set(String endpoint, String token) throws Exception {
        synchronized (LOCK) {
            String binding = binding(endpoint);
            validateToken(token);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keys.get());
            cipher.updateAAD(binding.getBytes(StandardCharsets.UTF_8));
            AtomicFile target = file(binding);
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Speech credential storage is unavailable.");
            FileOutputStream output = null;
            try {
                output = target.startWrite();
                output.write(1);
                output.write(cipher.getIV());
                output.write(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)));
                target.finishWrite(output);
            } catch (Exception error) {
                if (output != null) target.failWrite(output);
                throw error;
            }
        }
    }

    public void remove(String endpoint) throws Exception {
        synchronized (LOCK) {
            AtomicFile target = file(binding(endpoint));
            target.delete();
            for (String suffix : new String[] { "", ".bak", ".new" }) {
                if (!missing(new File(target.getBaseFile().getPath() + suffix))) {
                    throw new IllegalStateException("Speech credential could not be removed.");
                }
            }
        }
    }

    private static boolean missing(File file) throws ErrnoException {
        try { Os.lstat(file.getPath()); return false; }
        catch (ErrnoException error) {
            if (error.errno == OsConstants.ENOENT) return true;
            throw error;
        }
    }
}
