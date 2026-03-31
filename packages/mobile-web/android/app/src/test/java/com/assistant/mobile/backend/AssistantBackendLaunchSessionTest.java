package com.assistant.mobile.backend;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

public final class AssistantBackendLaunchSessionTest {
    @Test
    public void tracksSelectedBackendForCurrentProcess() {
        AssistantBackendLaunchSession.clear();
        assertFalse(AssistantBackendLaunchSession.hasSelectedBackend());

        AssistantBackendEntry backend = AssistantBackendEntry.createDefault();
        AssistantBackendLaunchSession.setSelectedBackend(backend);

        assertTrue(AssistantBackendLaunchSession.hasSelectedBackend());
        assertSame(backend, AssistantBackendLaunchSession.getSelectedBackend());

        AssistantBackendLaunchSession.clear();
        assertFalse(AssistantBackendLaunchSession.hasSelectedBackend());
    }
}
