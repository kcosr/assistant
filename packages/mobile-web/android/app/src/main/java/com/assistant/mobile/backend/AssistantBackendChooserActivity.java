package com.assistant.mobile.backend;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.assistant.mobile.R;
import com.assistant.mobile.voice.AssistantVoiceBackendSync;

public final class AssistantBackendChooserActivity extends AppCompatActivity {
    public static final String EXTRA_SELECTED_BACKEND_ID = "selectedBackendId";
    private static final int CARD_BG = Color.parseColor("#111827");
    private static final int CARD_BORDER = Color.parseColor("#374151");
    private static final int TITLE_TEXT = Color.parseColor("#F9FAFB");
    private static final int SECONDARY_TEXT = Color.parseColor("#9CA3AF");
    private static final int DIVIDER = Color.parseColor("#374151");
    private static final int ROW_BG = Color.parseColor("#1F2937");
    private static final int ROW_BORDER = Color.parseColor("#374151");
    private static final int ROW_ACTIVE_BG = Color.parseColor("#172554");
    private static final int ROW_ACTIVE_BORDER = Color.parseColor("#60A5FA");
    private static final int BADGE_BG = Color.parseColor("#1E3A8A");
    private static final int BADGE_BORDER = Color.parseColor("#60A5FA");
    private static final int BADGE_TEXT = Color.parseColor("#DBEAFE");
    private static final int DELETE_BG = Color.parseColor("#374151");
    private static final int DELETE_ICON = Color.parseColor("#FCA5A5");
    private static final int ACTION_BG = Color.parseColor("#2563EB");
    private static final int ACTION_TEXT = Color.WHITE;

    private LinearLayout backendListContainer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle(R.string.assistant_backend_choose_title);
        if (getWindow() != null) {
            getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            getWindow().setLayout(contentWidthPx(), ViewGroup.LayoutParams.WRAP_CONTENT);
        }
        setContentView(buildContentView());
        setFinishOnTouchOutside(false);
        renderBackends();
    }

    private View buildContentView() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setBackground(createCardBackground());
        card.setElevation(dp(8));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        card.addView(header);

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams titleBlockParams = layoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        titleBlockParams.weight = 1f;
        header.addView(titleBlock, titleBlockParams);

        TextView titleView = new TextView(this);
        titleView.setText(R.string.assistant_backend_choose_title);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setTextColor(TITLE_TEXT);
        titleBlock.addView(titleView);

        TextView subtitleView = new TextView(this);
        subtitleView.setText(R.string.assistant_backend_choose_subtitle);
        subtitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        subtitleView.setTextColor(SECONDARY_TEXT);
        LinearLayout.LayoutParams subtitleParams = layoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subtitleParams.topMargin = dp(6);
        titleBlock.addView(subtitleView, subtitleParams);

        Button addButton = new Button(this);
        addButton.setText(R.string.assistant_backend_add_button);
        addButton.setAllCaps(false);
        addButton.setMinHeight(0);
        addButton.setMinimumHeight(0);
        addButton.setPadding(dp(16), dp(10), dp(16), dp(10));
        addButton.setTextColor(ACTION_TEXT);
        addButton.setBackground(createActionButtonBackground());
        addButton.setOnClickListener((ignored) -> showAddDialog());
        header.addView(
            addButton,
            layoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );

        View divider = new View(this);
        divider.setBackgroundColor(DIVIDER);
        LinearLayout.LayoutParams dividerParams = layoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(1)
        );
        dividerParams.topMargin = dp(14);
        card.addView(divider, dividerParams);

        ScrollView listScrollView = new ScrollView(this);
        listScrollView.setFillViewport(false);
        listScrollView.setVerticalScrollBarEnabled(true);
        LinearLayout.LayoutParams listScrollParams = layoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            listHeightPx()
        );
        listScrollParams.topMargin = dp(12);
        card.addView(listScrollView, listScrollParams);

        backendListContainer = new LinearLayout(this);
        backendListContainer.setOrientation(LinearLayout.VERTICAL);
        listScrollView.addView(
            backendListContainer,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );

        TextView footerView = new TextView(this);
        footerView.setText(R.string.assistant_backend_choose_footer);
        footerView.setTextColor(SECONDARY_TEXT);
        footerView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        footerView.setGravity(Gravity.CENTER_HORIZONTAL);
        LinearLayout.LayoutParams footerParams = layoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        footerParams.topMargin = dp(12);
        card.addView(footerView, footerParams);

        return card;
    }

    private void renderBackends() {
        backendListContainer.removeAllViews();
        AssistantBackendConfig config = AssistantBackendStore.load(this);

        boolean allowDelete = config.savedBackends.size() > 1;
        for (AssistantBackendEntry entry : config.savedBackends) {
            LinearLayout.LayoutParams rowParams = layoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            rowParams.topMargin = backendListContainer.getChildCount() == 0 ? 0 : dp(12);
            backendListContainer.addView(
                createBackendRow(entry, config.lastUsedBackendId, allowDelete),
                rowParams
            );
        }
    }

    private View createBackendRow(
        AssistantBackendEntry entry,
        String lastUsedBackendId,
        boolean allowDelete
    ) {
        boolean isLastUsed = entry.id.equals(lastUsedBackendId);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(76));
        row.setPadding(dp(14), dp(12), dp(10), dp(12));
        row.setBackground(createRowBackground(isLastUsed));
        row.setClickable(true);
        row.setFocusable(true);
        row.setOnClickListener((ignored) -> selectBackend(entry));

        LinearLayout details = new LinearLayout(this);
        details.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams detailsParams = layoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        detailsParams.weight = 1f;
        row.addView(details, detailsParams);

        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        details.addView(heading);

        TextView labelView = new TextView(this);
        labelView.setText(entry.label);
        labelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        labelView.setTypeface(Typeface.DEFAULT_BOLD);
        labelView.setTextColor(TITLE_TEXT);
        labelView.setSingleLine(true);
        labelView.setEllipsize(TextUtils.TruncateAt.END);
        heading.addView(labelView);

        if (isLastUsed) {
            TextView badgeView = new TextView(this);
            badgeView.setText(R.string.assistant_backend_last_used_badge);
            badgeView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            badgeView.setTypeface(Typeface.DEFAULT_BOLD);
            badgeView.setTextColor(BADGE_TEXT);
            badgeView.setPadding(dp(8), dp(4), dp(8), dp(4));
            badgeView.setBackground(createBadgeBackground());
            LinearLayout.LayoutParams badgeParams = layoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            badgeParams.leftMargin = dp(10);
            heading.addView(badgeView, badgeParams);
        }

        TextView urlView = new TextView(this);
        urlView.setText(entry.url);
        urlView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        urlView.setTextColor(SECONDARY_TEXT);
        urlView.setSingleLine(true);
        urlView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams urlParams = layoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        urlParams.topMargin = dp(6);
        details.addView(urlView, urlParams);

        ImageButton deleteButton = new ImageButton(this);
        deleteButton.setImageResource(android.R.drawable.ic_menu_delete);
        deleteButton.setBackground(createDeleteButtonBackground());
        deleteButton.setContentDescription(getString(R.string.assistant_backend_delete_button));
        deleteButton.setPadding(dp(8), dp(8), dp(8), dp(8));
        deleteButton.setColorFilter(DELETE_ICON);
        deleteButton.setFocusable(true);
        deleteButton.setClickable(allowDelete);
        if (allowDelete) {
            deleteButton.setOnClickListener((ignored) -> {
                showDeleteDialog(entry);
            });
        } else {
            deleteButton.setVisibility(View.GONE);
        }
        LinearLayout.LayoutParams deleteParams = layoutParams(dp(36), dp(36));
        deleteParams.leftMargin = dp(8);
        row.addView(deleteButton, deleteParams);

        return row;
    }

    private GradientDrawable createCardBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(20));
        drawable.setColor(CARD_BG);
        drawable.setStroke(dp(1), CARD_BORDER);
        return drawable;
    }

    private GradientDrawable createRowBackground(boolean isLastUsed) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(16));
        drawable.setColor(isLastUsed ? ROW_ACTIVE_BG : ROW_BG);
        drawable.setStroke(dp(1), isLastUsed ? ROW_ACTIVE_BORDER : ROW_BORDER);
        return drawable;
    }

    private GradientDrawable createBadgeBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(999));
        drawable.setColor(BADGE_BG);
        drawable.setStroke(dp(1), BADGE_BORDER);
        return drawable;
    }

    private GradientDrawable createDeleteButtonBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(999));
        drawable.setColor(DELETE_BG);
        return drawable;
    }

    private GradientDrawable createActionButtonBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dp(999));
        drawable.setColor(ACTION_BG);
        return drawable;
    }

    private int contentWidthPx() {
        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        return Math.min(dp(460), Math.max(dp(300), screenWidth - dp(40)));
    }

    private int listHeightPx() {
        int screenHeight = getResources().getDisplayMetrics().heightPixels;
        return Math.min(dp(320), Math.max(dp(160), screenHeight - dp(220)));
    }

    private void showAddDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(8), dp(24), 0);

        EditText labelInput = new EditText(this);
        labelInput.setHint(R.string.assistant_backend_label_hint);
        labelInput.setSingleLine(true);
        form.addView(
            labelInput,
            layoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );

        EditText urlInput = new EditText(this);
        urlInput.setHint(R.string.assistant_backend_url_hint);
        urlInput.setSingleLine(true);
        urlInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        LinearLayout.LayoutParams urlParams = layoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        urlParams.topMargin = dp(12);
        form.addView(urlInput, urlParams);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.assistant_backend_add_dialog_title)
            .setView(form)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.assistant_backend_add_confirm_button, null)
            .create();
        dialog.setOnShowListener((ignored) -> {
            Button positiveButton = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            positiveButton.setOnClickListener((view) -> {
                AssistantBackendEntry entry = AssistantBackendEntry.create(
                    stringValue(labelInput),
                    stringValue(urlInput)
                );
                if (entry == null) {
                    urlInput.setError(getString(R.string.assistant_backend_url_error));
                    return;
                }
                AssistantBackendStore.save(
                    this,
                    AssistantBackendStore.load(this).withAddedBackend(entry)
                );
                dialog.dismiss();
                renderBackends();
            });
        });
        dialog.show();
    }

    private void showDeleteDialog(AssistantBackendEntry entry) {
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.assistant_backend_delete_confirm_title)
            .setMessage(
                getString(
                    R.string.assistant_backend_delete_confirm_message,
                    entry.label
                )
            )
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.assistant_backend_delete_confirm_button, (ignored, which) -> {
                AssistantBackendConfig config = AssistantBackendStore.load(this);
                if (!config.canDeleteBackend(entry.id)) {
                    return;
                }
                AssistantBackendStore.save(this, config.withDeletedBackend(entry.id));
                renderBackends();
            })
            .create();
        dialog.show();
    }

    private void selectBackend(AssistantBackendEntry entry) {
        AssistantBackendStore.save(
            this,
            AssistantBackendStore.load(this).withSelectedBackend(entry.id)
        );
        AssistantVoiceBackendSync.updateAssistantBaseUrl(this, entry.url);
        AssistantBackendLaunchSession.setSelectedBackend(entry);

        Intent resultIntent = new Intent();
        resultIntent.putExtra(EXTRA_SELECTED_BACKEND_ID, entry.id);
        setResult(Activity.RESULT_OK, resultIntent);
        finish();
    }

    private LinearLayout.LayoutParams layoutParams(int width, int height) {
        return new LinearLayout.LayoutParams(width, height);
    }

    private int dp(int value) {
        return Math.round(
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
            )
        );
    }

    private String stringValue(EditText input) {
        CharSequence text = input.getText();
        return text == null ? "" : text.toString();
    }
}
