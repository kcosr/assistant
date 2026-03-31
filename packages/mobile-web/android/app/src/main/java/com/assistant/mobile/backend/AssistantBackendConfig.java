package com.assistant.mobile.backend;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;

final class AssistantBackendConfig {
    final List<AssistantBackendEntry> savedBackends;
    final String lastUsedBackendId;

    AssistantBackendConfig(List<AssistantBackendEntry> savedBackends, String lastUsedBackendId) {
        List<AssistantBackendEntry> normalized = new ArrayList<>(savedBackends);
        if (normalized.isEmpty()) {
            AssistantBackendEntry defaultEntry = AssistantBackendEntry.createDefault();
            normalized.add(defaultEntry);
            this.lastUsedBackendId = defaultEntry.id;
        } else {
            this.lastUsedBackendId = normalizeLastUsed(lastUsedBackendId, normalized);
        }
        this.savedBackends = Collections.unmodifiableList(normalized);
    }

    static AssistantBackendConfig createDefault() {
        AssistantBackendEntry defaultEntry = AssistantBackendEntry.createDefault();
        return new AssistantBackendConfig(
            Collections.singletonList(defaultEntry),
            defaultEntry.id
        );
    }

    static AssistantBackendConfig fromJson(String rawJson) {
        if (rawJson == null || rawJson.trim().isEmpty()) {
            return createDefault();
        }

        try {
            JSONObject jsonObject = new JSONObject(rawJson);
            JSONArray savedBackends = jsonObject.optJSONArray("savedBackends");
            ArrayList<AssistantBackendEntry> entries = new ArrayList<>();
            HashSet<String> seenIds = new HashSet<>();
            if (savedBackends != null) {
                for (int index = 0; index < savedBackends.length(); index++) {
                    AssistantBackendEntry entry = AssistantBackendEntry.fromJson(
                        savedBackends.optJSONObject(index)
                    );
                    if (entry == null || !seenIds.add(entry.id)) {
                        continue;
                    }
                    entries.add(entry);
                }
            }
            return new AssistantBackendConfig(
                entries,
                jsonObject.optString("lastUsedBackendId", "")
            );
        } catch (JSONException ignored) {
            return createDefault();
        }
    }

    String toJsonString() {
        JSONObject jsonObject = new JSONObject();
        JSONArray savedBackendsJson = new JSONArray();
        try {
            for (AssistantBackendEntry entry : savedBackends) {
                savedBackendsJson.put(entry.toJson());
            }
            jsonObject.put("savedBackends", savedBackendsJson);
            jsonObject.put("lastUsedBackendId", lastUsedBackendId);
        } catch (JSONException ignored) {
            return "{\"savedBackends\":[],\"lastUsedBackendId\":\"\"}";
        }
        return jsonObject.toString();
    }

    AssistantBackendEntry findBackend(String backendId) {
        String normalizedId = backendId == null ? "" : backendId.trim();
        if (normalizedId.isEmpty()) {
            return null;
        }
        for (AssistantBackendEntry entry : savedBackends) {
            if (entry.id.equals(normalizedId)) {
                return entry;
            }
        }
        return null;
    }

    AssistantBackendConfig withSelectedBackend(String backendId) {
        AssistantBackendEntry selected = findBackend(backendId);
        if (selected == null) {
            return this;
        }
        return new AssistantBackendConfig(savedBackends, selected.id);
    }

    AssistantBackendConfig withAddedBackend(AssistantBackendEntry entry) {
        if (entry == null) {
            return this;
        }
        ArrayList<AssistantBackendEntry> updated = new ArrayList<>(savedBackends);
        updated.add(entry);
        return new AssistantBackendConfig(updated, lastUsedBackendId);
    }

    AssistantBackendConfig withDeletedBackend(String backendId) {
        if (savedBackends.size() <= 1) {
            return this;
        }
        String normalizedId = backendId == null ? "" : backendId.trim();
        if (normalizedId.isEmpty()) {
            return this;
        }
        ArrayList<AssistantBackendEntry> updated = new ArrayList<>();
        boolean removed = false;
        for (AssistantBackendEntry entry : savedBackends) {
            if (entry.id.equals(normalizedId)) {
                removed = true;
                continue;
            }
            updated.add(entry);
        }
        if (!removed || updated.isEmpty()) {
            return this;
        }
        String nextLastUsedBackendId = lastUsedBackendId;
        if (normalizedId.equals(lastUsedBackendId)) {
            nextLastUsedBackendId = updated.get(0).id;
        }
        return new AssistantBackendConfig(updated, nextLastUsedBackendId);
    }

    boolean canDeleteBackend(String backendId) {
        return savedBackends.size() > 1 && findBackend(backendId) != null;
    }

    private static String normalizeLastUsed(String backendId, List<AssistantBackendEntry> savedBackends) {
        String normalizedId = backendId == null ? "" : backendId.trim();
        if (normalizedId.isEmpty()) {
            return savedBackends.get(0).id;
        }
        for (AssistantBackendEntry entry : savedBackends) {
            if (entry.id.equals(normalizedId)) {
                return normalizedId;
            }
        }
        return savedBackends.get(0).id;
    }
}
