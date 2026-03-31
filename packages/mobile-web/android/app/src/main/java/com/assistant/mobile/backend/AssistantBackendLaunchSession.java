package com.assistant.mobile.backend;

final class AssistantBackendLaunchSession {
    private static AssistantBackendEntry selectedBackend;

    private AssistantBackendLaunchSession() {}

    static synchronized AssistantBackendEntry getSelectedBackend() {
        return selectedBackend;
    }

    static synchronized boolean hasSelectedBackend() {
        return selectedBackend != null;
    }

    static synchronized void setSelectedBackend(AssistantBackendEntry backend) {
        selectedBackend = backend;
    }

    static synchronized void clear() {
        selectedBackend = null;
    }
}
