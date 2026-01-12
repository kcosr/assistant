/**
 * Assistant Frontend Configuration
 */

// API host for backend connections (WebSocket and HTTP)
// Uses https:// and wss:// automatically when set
// window.ASSISTANT_API_HOST = 'assistant';

// Set to true to use http:// and ws:// instead of https:// and wss://
// Useful for local development without valid SSL certs
// window.ASSISTANT_INSECURE = true;

// Enable push notifications on mobile (requires google-services.json)
// Disabled by default to prevent crashes when Firebase isn't configured
window.__ASSISTANT_ENABLE_PUSH__ = false;

// Show FCM token modal on mobile registration (for initial setup)
// Only has effect when push is enabled on Android builds
window.__ASSISTANT_SHOW_FCM_TOKEN__ = false;
