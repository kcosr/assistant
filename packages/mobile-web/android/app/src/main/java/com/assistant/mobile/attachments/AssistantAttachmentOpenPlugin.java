package com.assistant.mobile.attachments;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;

@CapacitorPlugin(name = "AssistantAttachmentOpen")
public final class AssistantAttachmentOpenPlugin extends Plugin {
    @PluginMethod
    public void openHtmlAttachment(PluginCall call) {
        String contentBase64 = call.getString("contentBase64");
        if (contentBase64 == null || contentBase64.trim().isEmpty()) {
            call.reject("contentBase64 is required");
            return;
        }

        byte[] attachmentBytes;
        try {
            attachmentBytes = Base64.decode(contentBase64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("Invalid contentBase64", error);
            return;
        }

        String fileName = call.getString("fileName", "attachment.html");
        String contentType = call.getString("contentType", "text/html");
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "attachment.html";
        }
        if (contentType == null || contentType.trim().isEmpty()) {
            contentType = "text/html";
        }

        File exportedFile;
        try {
            exportedFile = AssistantHtmlAttachmentExportStore.getOrCreate(
                getContext(),
                fileName,
                attachmentBytes,
                contentType
            );
        } catch (IOException error) {
            call.reject("Failed to prepare HTML attachment", error);
            return;
        }

        Uri uri;
        try {
            uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                exportedFile
            );
        } catch (IllegalArgumentException error) {
            call.reject("Failed to share HTML attachment", error);
            return;
        }

        Intent openIntent = new Intent(Intent.ACTION_VIEW);
        openIntent.setDataAndType(uri, "text/html");
        openIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        openIntent.setClipData(ClipData.newUri(getContext().getContentResolver(), "attachment", uri));
        if (getActivity() == null) {
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }

        try {
            if (getActivity() != null) {
                getActivity().startActivity(openIntent);
            } else {
                getContext().startActivity(openIntent);
            }
        } catch (ActivityNotFoundException error) {
            call.reject("No browser available to open HTML attachment", error);
            return;
        }

        JSObject result = new JSObject();
        result.put("uri", uri.toString());
        call.resolve(result);
    }
}
