use futures_util::{SinkExt, StreamExt};
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Desktop app settings persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Backend URL (e.g., "https://assistant" or "http://localhost:3000").
    #[serde(default = "default_backend_url")]
    pub backend_url: String,

    /// Whether to skip TLS certificate validation for the backend.
    #[serde(default = "default_skip_cert_validation")]
    pub skip_cert_validation: bool,

    /// Local HTTP proxy port (assigned automatically).
    #[serde(default)]
    pub proxy_port: u16,

    /// Local WebSocket proxy port (assigned automatically).
    #[serde(default)]
    pub ws_proxy_port: u16,
}

fn default_backend_url() -> String {
    "https://assistant".to_string()
}

fn default_skip_cert_validation() -> bool {
    true
}

const HTTP_PROXY_CONNECT_TIMEOUT_SECS: u64 = 10;
const HTTP_PROXY_REQUEST_TIMEOUT_SECS: u64 = 30;

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            backend_url: default_backend_url(),
            skip_cert_validation: default_skip_cert_validation(),
            proxy_port: 0,
            ws_proxy_port: 0,
        }
    }
}

struct ProxyState {
    backend_url: String,
    http_client: reqwest::Client,
}

impl ProxyState {
    fn new(backend_url: String, skip_cert_validation: bool) -> Self {
        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(skip_cert_validation)
            .connect_timeout(Duration::from_secs(HTTP_PROXY_CONNECT_TIMEOUT_SECS))
            .timeout(Duration::from_secs(HTTP_PROXY_REQUEST_TIMEOUT_SECS))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            backend_url,
            http_client,
        }
    }

    fn ws_url(&self) -> String {
        let url = self
            .backend_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        format!("{}/ws", url.trim_end_matches('/'))
    }
}

struct AppState {
    settings: Mutex<AppSettings>,
    settings_path: PathBuf,
    proxy_shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    ws_proxy_shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl AppState {
    fn load(app: &AppHandle) -> Self {
        let settings_path = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| ".".into()))
            .join("settings.json");

        let settings = if settings_path.exists() {
            fs::read_to_string(&settings_path)
                .ok()
                .and_then(|data| serde_json::from_str(&data).ok())
                .unwrap_or_default()
        } else {
            AppSettings::default()
        };

        Self {
            settings: Mutex::new(settings),
            settings_path,
            proxy_shutdown_tx: Mutex::new(None),
            ws_proxy_shutdown_tx: Mutex::new(None),
        }
    }

    async fn save(&self) -> Result<(), String> {
        let settings = self.settings.lock().await;
        if let Some(parent) = self.settings_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let data = serde_json::to_string_pretty(&*settings).map_err(|e| e.to_string())?;
        fs::write(&self.settings_path, data).map_err(|e| e.to_string())
    }
}

/// Handle HTTP requests by proxying to backend
async fn handle_http_request(
    req: Request<Incoming>,
    proxy_state: Arc<ProxyState>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let uri = req.uri().clone();
    let headers = req.headers().clone();
    let path = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let method = req.method().clone();

    // Build backend URL
    let backend_url = format!("{}{}", proxy_state.backend_url.trim_end_matches('/'), path);
    // Collect request body
    let body_bytes = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            eprintln!("[proxy] Failed to read request body: {}", e);
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Full::new(Bytes::from("Failed to read request body")))
                .unwrap());
        }
    };

    // Build proxied request
    let mut proxy_req = proxy_state.http_client.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET),
        &backend_url,
    );

    // Copy headers (except host)
    for (name, value) in headers.iter() {
        if name != "host" {
            if let Ok(v) = value.to_str() {
                proxy_req = proxy_req.header(name.as_str(), v);
            }
        }
    }

    // Add body if present
    if !body_bytes.is_empty() {
        proxy_req = proxy_req.body(body_bytes.to_vec());
    }

    // Execute request
    match proxy_req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let mut builder = Response::builder().status(status.as_u16());

            // Copy response headers
            for (name, value) in resp.headers() {
                // Skip transfer-encoding since we're not chunking
                if name != "transfer-encoding" {
                    builder = builder.header(name.as_str(), value.as_bytes());
                }
            }

            // Get response body
            match resp.bytes().await {
                Ok(bytes) => Ok(builder.body(Full::new(bytes)).unwrap()),
                Err(e) => {
                    eprintln!("[proxy] Failed to read response body: {}", e);
                    Ok(Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Full::new(Bytes::from("Failed to read response")))
                        .unwrap())
                }
            }
        }
        Err(e) => {
            eprintln!("[proxy] Request failed: {}", e);
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Full::new(Bytes::from(format!("Proxy error: {}", e))))
                .unwrap())
        }
    }
}

/// Custom certificate verifier that accepts all certs
#[derive(Debug)]
struct NoVerifier;

impl rustls::client::danger::ServerCertVerifier for NoVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
        ]
    }
}

/// Handle WebSocket connection by proxying to backend
async fn handle_websocket_connection(
    client_stream: tokio::net::TcpStream,
    proxy_state: Arc<ProxyState>,
    skip_cert_validation: bool,
) {
    // Accept WebSocket from client
    let client_ws = match tokio_tungstenite::accept_async(client_stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[ws-proxy] Failed to accept WebSocket: {}", e);
            return;
        }
    };

    // Connect to backend WebSocket
    let ws_url = proxy_state.ws_url();
    println!("[ws-proxy] Connecting to backend: {}", ws_url);

    let backend_ws = if skip_cert_validation {
        let connector = tokio_tungstenite::Connector::Rustls(Arc::new(
            rustls::ClientConfig::builder()
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(NoVerifier))
                .with_no_client_auth(),
        ));

        match tokio_tungstenite::connect_async_tls_with_config(&ws_url, None, false, Some(connector))
            .await
        {
            Ok((ws, _)) => ws,
            Err(e) => {
                eprintln!("[ws-proxy] Failed to connect to backend WebSocket: {}", e);
                return;
            }
        }
    } else {
        match tokio_tungstenite::connect_async(&ws_url).await {
            Ok((ws, _)) => ws,
            Err(e) => {
                eprintln!("[ws-proxy] Failed to connect to backend WebSocket: {}", e);
                return;
            }
        }
    };

    println!("[ws-proxy] Connected to backend, proxying messages");

    let (mut client_write, mut client_read) = client_ws.split();
    let (mut backend_write, mut backend_read) = backend_ws.split();

    // Proxy messages bidirectionally
    let client_to_backend = async {
        while let Some(msg) = client_read.next().await {
            match msg {
                Ok(msg) => {
                    if let Err(e) = backend_write.send(msg).await {
                        eprintln!("[ws-proxy] Failed to send to backend: {}", e);
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[ws-proxy] Client read error: {}", e);
                    break;
                }
            }
        }
    };

    let backend_to_client = async {
        while let Some(msg) = backend_read.next().await {
            match msg {
                Ok(msg) => {
                    if let Err(e) = client_write.send(msg).await {
                        eprintln!("[ws-proxy] Failed to send to client: {}", e);
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[ws-proxy] Backend read error: {}", e);
                    break;
                }
            }
        }
    };

    tokio::select! {
        _ = client_to_backend => {},
        _ = backend_to_client => {},
    }

    println!("[ws-proxy] Connection closed");
}

/// Start the HTTP proxy server
async fn start_http_proxy(
    backend_url: String,
    skip_cert_validation: bool,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = TcpListener::bind(addr).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let proxy_state = Arc::new(ProxyState::new(backend_url.clone(), skip_cert_validation));
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    println!(
        "[http-proxy] Starting on http://localhost:{} -> {}",
        port, backend_url
    );

    tokio::spawn(async move {
        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, _)) => {
                            let proxy_state = proxy_state.clone();

                            tokio::spawn(async move {
                                let io = TokioIo::new(stream);
                                let service = service_fn(move |req: Request<Incoming>| {
                                    let proxy_state = proxy_state.clone();
                                    async move { handle_http_request(req, proxy_state).await }
                                });

                                if let Err(e) = http1::Builder::new()
                                    .serve_connection(io, service)
                                    .await
                                {
                                    eprintln!("[http-proxy] Connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            eprintln!("[http-proxy] Accept error: {}", e);
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    println!("[http-proxy] Shutting down");
                    break;
                }
            }
        }
    });

    Ok((port, shutdown_tx))
}

/// Start the WebSocket proxy server
async fn start_ws_proxy(
    backend_url: String,
    skip_cert_validation: bool,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = TcpListener::bind(addr).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let proxy_state = Arc::new(ProxyState::new(backend_url.clone(), skip_cert_validation));
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let ws_url = proxy_state.ws_url();
    println!(
        "[ws-proxy] Starting on ws://localhost:{} -> {}",
        port, ws_url
    );

    tokio::spawn(async move {
        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, _)) => {
                            let proxy_state = proxy_state.clone();

                            tokio::spawn(async move {
                                handle_websocket_connection(stream, proxy_state, skip_cert_validation).await;
                            });
                        }
                        Err(e) => {
                            eprintln!("[ws-proxy] Accept error: {}", e);
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    println!("[ws-proxy] Shutting down");
                    break;
                }
            }
        }
    });

    Ok((port, shutdown_tx))
}

/// Get the current backend URL setting.
#[tauri::command]
async fn get_backend_url(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    Ok(settings.backend_url.clone())
}

/// Set the backend URL and persist to disk.
#[tauri::command]
async fn set_backend_url(url: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.lock().await;
        settings.backend_url = url;
    }
    state.save().await
}

/// Get all settings.
#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

/// Update settings and restart proxy if needed.
#[tauri::command]
async fn update_settings(
    backend_url: Option<String>,
    skip_cert_validation: Option<bool>,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let mut needs_proxy_restart = false;

    {
        let mut settings = state.settings.lock().await;
        if let Some(url) = backend_url {
            if url != settings.backend_url {
                settings.backend_url = url;
                needs_proxy_restart = true;
            }
        }
        if let Some(skip) = skip_cert_validation {
            if skip != settings.skip_cert_validation {
                settings.skip_cert_validation = skip;
                needs_proxy_restart = true;
            }
        }
    }

    state.save().await?;

    if needs_proxy_restart {
        restart_proxy_internal(&state).await?;
    }

    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

/// Get the local proxy URL that the web client should connect to.
/// Returns JSON with http_port and ws_port.
#[tauri::command]
async fn get_proxy_url(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().await;
    if settings.proxy_port > 0 {
        Ok(format!("localhost:{}", settings.proxy_port))
    } else {
        Err("Proxy not running".to_string())
    }
}

/// Get the WebSocket proxy port.
#[tauri::command]
async fn get_ws_proxy_port(state: State<'_, AppState>) -> Result<u16, String> {
    let settings = state.settings.lock().await;
    if settings.ws_proxy_port > 0 {
        Ok(settings.ws_proxy_port)
    } else {
        Err("WebSocket proxy not running".to_string())
    }
}

/// Restart the proxy with current settings.
async fn restart_proxy_internal(state: &AppState) -> Result<(), String> {
    // Stop existing proxies
    if let Some(tx) = state.proxy_shutdown_tx.lock().await.take() {
        let _ = tx.send(());
    }
    if let Some(tx) = state.ws_proxy_shutdown_tx.lock().await.take() {
        let _ = tx.send(());
    }

    // Get settings
    let (backend_url, skip_cert_validation) = {
        let settings = state.settings.lock().await;
        (settings.backend_url.clone(), settings.skip_cert_validation)
    };

    // Start HTTP proxy
    let (http_port, http_shutdown_tx) =
        start_http_proxy(backend_url.clone(), skip_cert_validation).await?;

    // Start WebSocket proxy
    let (ws_port, ws_shutdown_tx) =
        start_ws_proxy(backend_url, skip_cert_validation).await?;

    // Update state
    {
        let mut settings = state.settings.lock().await;
        settings.proxy_port = http_port;
        settings.ws_proxy_port = ws_port;
    }
    *state.proxy_shutdown_tx.lock().await = Some(http_shutdown_tx);
    *state.ws_proxy_shutdown_tx.lock().await = Some(ws_shutdown_tx);

    state.save().await?;

    Ok(())
}

fn install_crypto_provider() {
    if let Err(err) = rustls::crypto::ring::default_provider().install_default() {
        eprintln!("[tls] Failed to install rustls crypto provider: {:?}", err);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_crypto_provider();

    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = AppState::load(&app_handle);
            app.manage(state);

            // Start the proxy
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let state: State<'_, AppState> = app_handle_clone.state();
                if let Err(e) = restart_proxy_internal(&state).await {
                    eprintln!("[proxy] Failed to start: {}", e);
                } else {
                    // Emit event with proxy ports
                    let settings = state.settings.lock().await;
                    let _ = app_handle_clone.emit(
                        "proxy-ready",
                        serde_json::json!({
                            "http_port": settings.proxy_port,
                            "ws_port": settings.ws_proxy_port,
                        }),
                    );
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            set_backend_url,
            get_settings,
            update_settings,
            get_proxy_url,
            get_ws_proxy_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
