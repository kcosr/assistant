package com.assistant.mobile.attachments;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Comparator;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class AssistantHtmlAttachmentExportStore {
    private static final String EXPORT_DIR = "attachment_exports";
    static final int MAX_EXPORTED_FILES = 32;

    private AssistantHtmlAttachmentExportStore() {}

    static File getOrCreate(
        Context context,
        String fileName,
        byte[] attachmentBytes,
        String contentType
    ) throws IOException {
        File dir = new File(context.getCacheDir(), EXPORT_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Failed to create attachment export directory");
        }
        String normalizedContentType = normalizeContentType(contentType);

        File exportFile = new File(
            dir,
            buildExportFileName(fileName, attachmentBytes, normalizedContentType)
        );
        if (!exportFile.exists() || exportFile.length() != attachmentBytes.length) {
            writeFileAtomically(exportFile, attachmentBytes);
        }
        // Touch the file so frequently-opened attachments survive pruning.
        exportFile.setLastModified(System.currentTimeMillis());
        pruneExportDirectory(dir, exportFile);
        return exportFile;
    }

    static String buildExportFileName(
        String fileName,
        byte[] attachmentBytes,
        String contentType
    ) {
        String cleanedFileName = sanitizePathName(fileName);
        String baseName = cleanedFileName;
        int dotIndex = cleanedFileName.lastIndexOf('.');
        if (dotIndex > 0) {
            baseName = cleanedFileName.substring(0, dotIndex);
        }
        baseName = normalizeSlug(baseName);
        if (baseName.isEmpty()) {
            baseName = "attachment";
        }
        String extension = resolveExtension(cleanedFileName, contentType);
        String hash = sha256Hex(fileName, contentType, attachmentBytes);
        return baseName + "-" + hash.substring(0, 16) + "." + extension;
    }

    private static String sanitizePathName(String fileName) {
        String trimmed = fileName == null ? "" : fileName.trim();
        String slashStripped = trimmed.replace('\\', '/');
        int slashIndex = slashStripped.lastIndexOf('/');
        String leafName = slashIndex >= 0 ? slashStripped.substring(slashIndex + 1) : slashStripped;
        return leafName.isEmpty() ? "attachment.html" : leafName;
    }

    private static String normalizeSlug(String value) {
        StringBuilder slug = new StringBuilder();
        boolean previousDash = false;
        for (int i = 0; i < value.length(); i += 1) {
            char ch = Character.toLowerCase(value.charAt(i));
            if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
                slug.append(ch);
                previousDash = false;
            } else if (!previousDash) {
                slug.append('-');
                previousDash = true;
            }
        }
        int start = 0;
        int end = slug.length();
        while (start < end && slug.charAt(start) == '-') {
            start += 1;
        }
        while (end > start && slug.charAt(end - 1) == '-') {
            end -= 1;
        }
        return slug.substring(start, end);
    }

    static String resolveExtension(String fileName, String contentType) {
        int dotIndex = fileName.lastIndexOf('.');
        if (dotIndex >= 0 && dotIndex + 1 < fileName.length()) {
            StringBuilder extension = new StringBuilder();
            for (int i = dotIndex + 1; i < fileName.length(); i += 1) {
                char ch = Character.toLowerCase(fileName.charAt(i));
                if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
                    extension.append(ch);
                }
            }
            if (extension.length() > 0) {
                return extension.toString();
            }
        }
        return "html";
    }

    static String normalizeContentType(String contentType) {
        String mimeType = contentType == null ? "" : contentType.trim().toLowerCase();
        int semicolonIndex = mimeType.indexOf(';');
        if (semicolonIndex >= 0) {
            mimeType = mimeType.substring(0, semicolonIndex).trim();
        }
        return mimeType.isEmpty() ? "text/html" : mimeType;
    }

    private static void writeFileAtomically(File exportFile, byte[] attachmentBytes) throws IOException {
        File dir = exportFile.getParentFile();
        if (dir == null) {
            throw new IOException("Attachment export directory unavailable");
        }
        File tempFile = File.createTempFile(exportFile.getName() + "-", ".tmp", dir);
        boolean moved = false;
        try {
            try (FileOutputStream output = new FileOutputStream(tempFile)) {
                output.write(attachmentBytes);
                output.getFD().sync();
            }
            try {
                Files.move(
                    tempFile.toPath(),
                    exportFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE
                );
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(
                    tempFile.toPath(),
                    exportFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING
                );
            }
            moved = true;
        } finally {
            if (!moved && tempFile.exists()) {
                tempFile.delete();
            }
        }
    }

    private static void pruneExportDirectory(File dir, File preserveFile) {
        File[] files = dir.listFiles();
        if (files == null || files.length == 0) {
            return;
        }

        for (File file : files) {
            if (file.isFile() && file.getName().endsWith(".tmp")) {
                file.delete();
            }
        }

        File[] exportFiles = Arrays.stream(files)
            .filter(File::isFile)
            .filter(file -> !file.getName().endsWith(".tmp"))
            .toArray(File[]::new);

        if (exportFiles.length <= MAX_EXPORTED_FILES) {
            return;
        }

        Arrays.sort(
            exportFiles,
            Comparator.comparingLong(File::lastModified).reversed()
        );

        for (int i = MAX_EXPORTED_FILES; i < exportFiles.length; i += 1) {
            File file = exportFiles[i];
            if (file.equals(preserveFile)) {
                continue;
            }
            file.delete();
        }
    }

    private static String sha256Hex(String fileName, String contentType, byte[] attachmentBytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update((fileName + "\n" + contentType + "\n").getBytes(StandardCharsets.UTF_8));
            digest.update(attachmentBytes);
            byte[] hash = digest.digest();
            StringBuilder builder = new StringBuilder(hash.length * 2);
            for (byte value : hash) {
                int normalized = value & 0xff;
                if (normalized < 0x10) {
                    builder.append('0');
                }
                builder.append(Integer.toHexString(normalized));
            }
            return builder.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }
}
