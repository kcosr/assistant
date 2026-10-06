package com.assistant.mobile.voice;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Build;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Secret input stays in a masked native view, excluded from screenshots, saved state, and autofill. */
final class AssistantSpeechCredentialDialog {
    interface Reply {
        void done(boolean configured);
        void failed(String message, boolean connectionChanged);
    }
    interface Host { void action(String action, String secret, Reply reply); }

    private final Activity activity;
    private final AlertDialog dialog;
    private final EditText secret;
    private final TextView status;
    private final Button save;
    private final Button test;
    private final Button remove;
    private final Host host;
    private boolean busy;
    private boolean configured;

    AssistantSpeechCredentialDialog(Activity activity, String endpoint, boolean configured, Host host, Runnable dismissed) {
        this.activity = activity;
        this.host = host;
        this.configured = configured;
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding / 2, padding, 0);
        TextView destination = new TextView(activity);
        destination.setText(endpoint + "\n" + (configured ? "A token is saved on this device." : "No token is saved on this device."));
        content.addView(destination);
        secret = new EditText(activity);
        secret.setHint("Speech server bearer token");
        secret.setContentDescription(secret.getHint());
        secret.setSingleLine(true);
        secret.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        secret.setImeOptions(EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        secret.setSaveEnabled(false);
        if (Build.VERSION.SDK_INT >= 26) secret.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        content.addView(secret);
        status = new TextView(activity);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setText("Test checks access to the model list without generating speech.");
        content.addView(status);
        LinearLayout actions = new LinearLayout(activity);
        save = button(actions, "Save", "save");
        test = button(actions, "Test", "test");
        remove = button(actions, "Remove", "remove");
        remove.setEnabled(configured);
        content.addView(actions);
        dialog = new AlertDialog.Builder(activity).setTitle("Speech server token")
            .setView(content).setNegativeButton("Close", (ignored, which) -> secret.getText().clear()).create();
        dialog.setOnCancelListener(ignored -> secret.getText().clear());
        dialog.setOnDismissListener(ignored -> { secret.getText().clear(); dismissed.run(); });
    }

    private Button button(LinearLayout row, String label, String action) {
        Button button = new Button(activity);
        button.setText(label);
        button.setOnClickListener(ignored -> perform(action));
        row.addView(button);
        return button;
    }

    void show() {
        if (dialog.getWindow() != null) dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        dialog.show();
        if (dialog.getWindow() != null) dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    void dismiss() { secret.getText().clear(); dialog.dismiss(); }

    private void perform(String action) {
        if (busy) return;
        String entered = secret.getText().toString();
        if (action.equals("save") && entered.isEmpty()) { status.setText("Enter a token before saving."); return; }
        String submitted = action.equals("remove") || entered.isEmpty() ? null : entered;
        busy = true;
        enable(false);
        status.setText(action.equals("test") ? "Testing access…" : "Saving changes…");
        host.action(action, submitted, new Reply() {
            @Override public void done(boolean saved) {
                activity.runOnUiThread(() -> {
                    if (!dialog.isShowing()) return;
                    configured = saved;
                    if (!action.equals("test")) { dismiss(); return; }
                    busy = false;
                    enable(true);
                    status.setText("Connection succeeded. The model list is accessible.");
                });
            }
            @Override public void failed(String message, boolean connectionChanged) {
                activity.runOnUiThread(() -> {
                    if (!dialog.isShowing()) return;
                    busy = false;
                    enable(!connectionChanged);
                    status.setText(message);
                    if (connectionChanged) secret.getText().clear();
                });
            }
        });
    }

    private void enable(boolean enabled) {
        save.setEnabled(enabled);
        test.setEnabled(enabled);
        remove.setEnabled(enabled && configured);
        secret.setEnabled(enabled);
    }
}
