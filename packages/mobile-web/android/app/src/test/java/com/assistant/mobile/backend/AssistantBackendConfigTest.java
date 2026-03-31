package com.assistant.mobile.backend;

import org.junit.Test;

import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

public final class AssistantBackendConfigTest {
    @Test
    public void createDefaultSeedsAssistantAndMarksItLastUsed() {
        AssistantBackendConfig config = AssistantBackendConfig.createDefault();

        assertEquals(1, config.savedBackends.size());
        assertEquals("Assistant", config.savedBackends.get(0).label);
        assertEquals("https://assistant", config.savedBackends.get(0).url);
        assertEquals("assistant", config.lastUsedBackendId);
    }

    @Test
    public void deletingLastUsedBackendFallsBackToAnotherSavedEntry() {
        AssistantBackendConfig config = AssistantBackendConfig.createDefault();
        AssistantBackendEntry extra = AssistantBackendEntry.create("Local", "https://example.test/");
        assertNotNull(extra);

        config = config.withAddedBackend(extra).withSelectedBackend(extra.id);
        config = config.withDeletedBackend(extra.id);

        assertEquals(1, config.savedBackends.size());
        assertEquals("assistant", config.lastUsedBackendId);
        assertEquals("https://assistant", config.savedBackends.get(0).url);
    }

    @Test
    public void deletingTheOnlySavedBackendIsIgnored() {
        AssistantBackendConfig config = AssistantBackendConfig.createDefault();

        AssistantBackendConfig updated = config.withDeletedBackend("assistant");

        assertEquals(1, updated.savedBackends.size());
        assertEquals("assistant", updated.savedBackends.get(0).id);
        assertEquals("assistant", updated.lastUsedBackendId);
    }

    @Test
    public void creatingBackendNormalizesUrlAndDefaultsLabel() {
        AssistantBackendEntry entry = AssistantBackendEntry.create(
            "",
            "https://assistant/example/"
        );

        assertNotNull(entry);
        assertEquals("https://assistant/example", entry.url);
        assertEquals("assistant/example", entry.label);
    }

    @Test
    public void invalidLastUsedFallsBackToFirstSavedBackend() {
        AssistantBackendConfig config = new AssistantBackendConfig(
            Collections.singletonList(AssistantBackendEntry.createDefault()),
            "missing"
        );

        assertEquals("assistant", config.lastUsedBackendId);
    }
}
