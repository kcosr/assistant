package com.assistant.mobile.attachments;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public final class AssistantHtmlAttachmentExportStoreTest {
    @Test
    public void normalizeContentTypeStripsParametersAndDefaultsToHtml() {
        assertEquals("text/html", AssistantHtmlAttachmentExportStore.normalizeContentType("text/html; charset=utf-8"));
        assertEquals("text/html", AssistantHtmlAttachmentExportStore.normalizeContentType(" "));
        assertEquals("text/plain", AssistantHtmlAttachmentExportStore.normalizeContentType("TEXT/PLAIN; charset=utf-8"));
    }

    @Test
    public void resolveExtensionPrefersSanitizedFilenameExtension() {
        assertEquals("html", AssistantHtmlAttachmentExportStore.resolveExtension("report.final.HTML", "text/plain"));
        assertEquals("txt", AssistantHtmlAttachmentExportStore.resolveExtension("notes.txt", "text/html"));
    }

    @Test
    public void resolveExtensionFallsBackToHtmlWhenFilenameHasNoExtension() {
        assertEquals("html", AssistantHtmlAttachmentExportStore.resolveExtension("report", "text/html"));
        assertEquals("html", AssistantHtmlAttachmentExportStore.resolveExtension("report", "text/plain"));
    }

    @Test
    public void buildExportFileNameSanitizesPathAndIncludesDeterministicHash() {
        String fileName = AssistantHtmlAttachmentExportStore.buildExportFileName(
            "nested/path/Weekly Report!!.html",
            "<html>Hello</html>".getBytes(StandardCharsets.UTF_8),
            "text/html"
        );

        assertTrue(fileName.startsWith("weekly-report-"));
        assertTrue(fileName.endsWith(".html"));
        assertEquals(fileName, AssistantHtmlAttachmentExportStore.buildExportFileName(
            "nested/path/Weekly Report!!.html",
            "<html>Hello</html>".getBytes(StandardCharsets.UTF_8),
            "text/html"
        ));
    }
}
