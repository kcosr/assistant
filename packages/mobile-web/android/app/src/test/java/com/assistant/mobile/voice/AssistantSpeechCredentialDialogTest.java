package com.assistant.mobile.voice;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Build;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.Shadows;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.O)
public final class AssistantSpeechCredentialDialogTest {
    @Test public void masksNativeInputAndClearsItAfterSaving() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        AtomicReference<String> submitted = new AtomicReference<>();
        AtomicInteger dismissed = new AtomicInteger();
        AssistantSpeechCredentialDialog manager = new AssistantSpeechCredentialDialog(activity,
            "https://assistant/speech/v1", false, (action, secret, reply) -> {
                assertEquals("save", action);
                submitted.set(secret);
                reply.done(true);
            }, dismissed::incrementAndGet);
        manager.show();
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        EditText input = find(dialog.getWindow().getDecorView(), EditText.class, null);
        assertNotNull(input);
        assertFalse(input.isSaveEnabled());
        assertEquals(InputType.TYPE_TEXT_VARIATION_PASSWORD, input.getInputType() & InputType.TYPE_MASK_VARIATION);
        assertEquals(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, input.getImportantForAutofill());
        assertTrue((dialog.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0);
        assertFalse(find(dialog.getWindow().getDecorView(), Button.class, "Remove").isEnabled());
        input.setText("native-only-secret");
        find(dialog.getWindow().getDecorView(), Button.class, "Save").performClick();
        assertEquals("native-only-secret", submitted.get());
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("", input.getText().toString());
        assertEquals(1, dismissed.get());
        assertFalse(dialog.isShowing());
        activity.finish();
    }

    @Test public void staleEndpointDisablesActionsAndClearsEnteredToken() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        AssistantSpeechCredentialDialog manager = new AssistantSpeechCredentialDialog(activity,
            "https://assistant/speech/v1", true, (action, secret, reply) ->
                reply.failed("Speech settings changed.", true), () -> {});
        manager.show();
        View root = ShadowAlertDialog.getLatestAlertDialog().getWindow().getDecorView();
        EditText input = find(root, EditText.class, null);
        input.setText("native-only-secret");
        find(root, Button.class, "Test").performClick();
        assertEquals("", input.getText().toString());
        assertFalse(input.isEnabled());
        for (String label : new String[] { "Save", "Test", "Remove" }) assertFalse(find(root, Button.class, label).isEnabled());
        manager.dismiss();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        activity.finish();
    }

    private static <T extends View> T find(View view, Class<T> type, String text) {
        if (type.isInstance(view) && (text == null || text.equals(((Button) view).getText().toString()))) return type.cast(view);
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                T result = find(group.getChildAt(index), type, text);
                if (result != null) return result;
            }
        }
        return null;
    }
}
