/**
 * Assistant Frontend Configuration
 */

// API host for backend connections (WebSocket and HTTP)
window.ASSISTANT_API_HOST = 'assistant';

// Enable push notifications on mobile (requires google-services.json)
// Disabled by default to prevent crashes when Firebase isn't configured
window.__ASSISTANT_ENABLE_PUSH__ = false;

// Show FCM token modal on mobile registration (for initial setup)
// Only has effect when push is enabled on Android builds
window.__ASSISTANT_SHOW_FCM_TOKEN__ = false;
