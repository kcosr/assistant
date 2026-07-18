package com.assistant.mobile.voice;

/**
 * Pure helpers for the generation-fenced exclusive owner model described in the Realtime design.
 * Thread media remains the only live owner until Realtime media lands; these helpers keep admission
 * and stale-callback rules testable without the full service.
 */
final class AssistantVoiceControllerPolicy {
    static final String OWNER_THREAD = "thread";
    static final String OWNER_REALTIME = "realtime";

    static final String RUNTIME_MODE_THREAD = "thread";
    static final String RUNTIME_MODE_REALTIME = "realtime";

    private AssistantVoiceControllerPolicy() {}

    static String normalizeRuntimeMode(String value) {
        if (value == null) {
            return RUNTIME_MODE_THREAD;
        }
        String trimmed = value.trim().toLowerCase();
        if (RUNTIME_MODE_REALTIME.equals(trimmed)) {
            return RUNTIME_MODE_REALTIME;
        }
        return RUNTIME_MODE_THREAD;
    }

    static boolean isRealtimeRuntimeMode(String runtimeMode) {
        return RUNTIME_MODE_REALTIME.equals(normalizeRuntimeMode(runtimeMode));
    }

    /** Live Realtime owner pauses Thread auto-admission; preference alone does not. */
    static boolean shouldPauseThreadAdmission(String liveOwner) {
        return OWNER_REALTIME.equals(liveOwner);
    }

    static boolean shouldAcceptThreadAdmission(boolean admissionPaused, boolean runtimeConnected) {
        return !admissionPaused && runtimeConnected;
    }

    static boolean isCurrentGeneration(long activeGeneration, long callbackGeneration) {
        return callbackGeneration > 0L && callbackGeneration == activeGeneration;
    }

    static long nextGeneration(long currentGeneration) {
        long next = currentGeneration + 1L;
        return next <= 0L ? 1L : next;
    }

    /**
     * Settings apply that leaves Realtime while a call is live must become StopRealtime.
     * Phase 1 has no live Realtime media; the predicate is still the contract seam.
     */
    static boolean shouldStopRealtimeForConfig(
        String previousRuntimeMode,
        String nextRuntimeMode,
        String liveOwner
    ) {
        String previous = normalizeRuntimeMode(previousRuntimeMode);
        String next = normalizeRuntimeMode(nextRuntimeMode);
        if (OWNER_REALTIME.equals(liveOwner) && !RUNTIME_MODE_REALTIME.equals(next)) {
            return true;
        }
        return RUNTIME_MODE_REALTIME.equals(previous)
            && !RUNTIME_MODE_REALTIME.equals(next)
            && OWNER_REALTIME.equals(liveOwner);
    }
}
