package com.assistant.mobile.backend;

import android.content.Intent;
import android.os.Bundle;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import com.assistant.mobile.MainActivity;

public final class AssistantLaunchActivity extends AppCompatActivity {
    private static final String STATE_CHOOSER_LAUNCHED = "chooserLaunched";

    private boolean chooserLaunched = false;

    private final ActivityResultLauncher<Intent> chooserLauncher =
        registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            this::handleChooserResult
        );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            chooserLaunched = savedInstanceState.getBoolean(STATE_CHOOSER_LAUNCHED, false);
        }
        continueLaunch();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean(STATE_CHOOSER_LAUNCHED, chooserLaunched);
        super.onSaveInstanceState(outState);
    }

    private void continueLaunch() {
        if (isFinishing()) {
            return;
        }
        if (AssistantBackendLaunchSession.hasSelectedBackend()) {
            launchMainActivity();
            return;
        }
        if (chooserLaunched) {
            return;
        }
        chooserLaunched = true;
        chooserLauncher.launch(new Intent(this, AssistantBackendChooserActivity.class));
    }

    private void handleChooserResult(ActivityResult result) {
        chooserLaunched = false;
        if (result.getResultCode() != RESULT_OK || !AssistantBackendLaunchSession.hasSelectedBackend()) {
            finish();
            return;
        }
        launchMainActivity();
    }

    private void launchMainActivity() {
        Intent launchIntent = new Intent(getIntent());
        launchIntent.setClass(this, MainActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launchIntent);
        finish();
        overridePendingTransition(0, 0);
    }
}
