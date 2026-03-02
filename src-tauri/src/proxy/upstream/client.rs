// 上游客户端实现
// 基于高性能通讯接口封装

use dashmap::DashMap;
use rquest::{header, Client, Response, StatusCode};
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::RwLock;
use tokio::time::Duration;

/// 端点降级尝试的记录信息
#[derive(Debug, Clone)]
pub struct FallbackAttemptLog {
    /// 尝试的端点 URL
    pub endpoint_url: String,
    /// HTTP 状态码 (网络错误时为 None)
    pub status: Option<u16>,
    /// 错误描述
    pub error: String,
}

/// 上游调用结果，包含响应和降级尝试记录
pub struct UpstreamCallResult {
    /// 最终的 HTTP 响应
    pub response: Response,
    /// 降级过程中失败的端点尝试记录 (成功时为空)
    pub fallback_attempts: Vec<FallbackAttemptLog>,
}

/// 邮箱脱敏：只显示前3位 + *** + @域名前2位 + ***
/// 例: "userexample@gmail.com" → "use***@gm***"
pub fn mask_email(email: &str) -> String {
    if let Some(at_pos) = email.find('@') {
        let local = &email[..at_pos];
        let domain = &email[at_pos + 1..];
        let local_prefix: String = local.chars().take(3).collect();
        let domain_prefix: String = domain.chars().take(2).collect();
        format!("{}***@{}***", local_prefix, domain_prefix)
    } else {
        // 不是合法邮箱格式，直接截取前5位
        let prefix: String = email.chars().take(5).collect();
        format!("{}***", prefix)
    }
}

// Cloud Code v1internal endpoints (fallback order: Sandbox → Daily → Prod)
// 优先使用 Sandbox/Daily 环境以避免 Prod环境的 429 错误 (Ref: Issue #1176)
const V1_INTERNAL_BASE_URL_PROD: &str = "https://cloudcode-pa.googleapis.com/v1internal";
const V1_INTERNAL_BASE_URL_DAILY: &str = "https://daily-cloudcode-pa.googleapis.com/v1internal";
const V1_INTERNAL_BASE_URL_SANDBOX: &str =
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal";

const V1_INTERNAL_BASE_URL_FALLBACKS: [&str; 3] = [
    V1_INTERNAL_BASE_URL_SANDBOX, // 优先级 1: Sandbox (已知有效且稳定)
    V1_INTERNAL_BASE_URL_DAILY,   // 优先级 2: Daily (备用)
    V1_INTERNAL_BASE_URL_PROD,    // 优先级 3: Prod (仅作为兜底)
];

pub struct UpstreamClient {
    default_client: Client,
    proxy_pool: Option<Arc<crate::proxy::proxy_pool::ProxyPoolManager>>,
    client_cache: DashMap<String, Client>, // proxy_id -> Client
    user_agent_override: RwLock<Option<String>>,
    /// 上次成功的端点索引，用于优先直连（健康记忆）
    last_successful_endpoint: AtomicUsize,
    /// 上次成功的时间戳（秒级），用于判断记忆是否过期
    last_success_time: AtomicUsize,
}

impl UpstreamClient {
    pub fn new(
        proxy_config: Option<crate::proxy::config::UpstreamProxyConfig>,
        proxy_pool: Option<Arc<crate::proxy::proxy_pool::ProxyPoolManager>>,
    ) -> Self {
        let default_client = match Self::build_client_internal(proxy_config.clone()) {
            Ok(client) => client,
            Err(err_with_proxy) => {
                tracing::error!(
                    error = %err_with_proxy,
                    "Failed to create default HTTP client with configured upstream proxy; retrying without proxy"
                );
                match Self::build_client_internal(None) {
                    Ok(client) => client,
                    Err(err_without_proxy) => {
                        tracing::error!(
                            error = %err_without_proxy,
                            "Failed to create default HTTP client without proxy; falling back to bare client"
                        );
                        Client::new()
                    }
                }
            }
        };

        Self {
            default_client,
            proxy_pool,
            client_cache: DashMap::new(),
            user_agent_override: RwLock::new(None),
            last_successful_endpoint: AtomicUsize::new(0),
            last_success_time: AtomicUsize::new(0),
        }
    }

    /// Internal helper to build a client with optional upstream proxy config
    fn build_client_internal(
        proxy_config: Option<crate::proxy::config::UpstreamProxyConfig>,
    ) -> Result<Client, rquest::Error> {
        let mut builder = Client::builder()
            .emulation(rquest_util::Emulation::Chrome123)
            // Connection settings (优化连接复用，减少建立开销)
            .connect_timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(16) // 每主机最多 16 个空闲连接
            .pool_idle_timeout(Duration::from_secs(90)) // 空闲连接保持 90 秒
            .tcp_keepalive(Duration::from_secs(60)) // TCP 保活探测 60 秒
            .timeout(Duration::from_secs(600));

        builder = Self::apply_default_user_agent(builder);

        if let Some(config) = proxy_config {
            if config.enabled && !config.url.is_empty() {
                let url = crate::proxy::config::normalize_proxy_url(&config.url);
                if let Ok(proxy) = rquest::Proxy::all(&url) {
                    builder = builder.proxy(proxy);
                    tracing::info!("UpstreamClient enabled proxy: {}", url);
                }
            }
        }

        builder.build()
    }

    /// Build a client with a specific PoolProxyConfig (from ProxyPool)
    fn build_client_with_proxy(
        &self,
        proxy_config: crate::proxy::proxy_pool::PoolProxyConfig,
    ) -> Result<Client, rquest::Error> {
        // Reuse base settings similar to default client but with specific proxy
        let builder = Client::builder()
            .emulation(rquest_util::Emulation::Chrome123)
            .connect_timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(16)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(60))
            .timeout(Duration::from_secs(600))
            .proxy(proxy_config.proxy); // Apply the specific proxy

        Self::apply_default_user_agent(builder).build()
    }

    fn apply_default_user_agent(builder: rquest::ClientBuilder) -> rquest::ClientBuilder {
        let ua = crate::constants::USER_AGENT.as_str();
        if header::HeaderValue::from_str(ua).is_ok() {
            builder.user_agent(ua)
        } else {
            tracing::warn!(
                user_agent = %ua,
                "Invalid default User-Agent value, using fallback"
            );
            builder.user_agent("antigravity")
        }
    }

    /// Set dynamic User-Agent override
    pub async fn set_user_agent_override(&self, ua: Option<String>) {
        let mut lock = self.user_agent_override.write().await;
        *lock = ua;
        tracing::debug!("UpstreamClient User-Agent override updated: {:?}", lock);
    }

    /// Get current User-Agent
    pub async fn get_user_agent(&self) -> String {
        let ua_override = self.user_agent_override.read().await;
        ua_override
            .as_ref()
            .cloned()
            .unwrap_or_else(|| crate::constants::USER_AGENT.clone())
    }

    /// Get client for a specific account (or default if no proxy bound)
    pub async fn get_client(&self, account_id: Option<&str>) -> Client {
        if let Some(pool) = &self.proxy_pool {
            if let Some(acc_id) = account_id {
                // Try to get per-account proxy
                match pool.get_proxy_for_account(acc_id).await {
                    Ok(Some(proxy_cfg)) => {
                        // Check cache
                        if let Some(client) = self.client_cache.get(&proxy_cfg.entry_id) {
                            return client.clone();
                        }
                        // Build new client and cache it
                        match self.build_client_with_proxy(proxy_cfg.clone()) {
                            Ok(client) => {
                                self.client_cache
                                    .insert(proxy_cfg.entry_id.clone(), client.clone());
                                tracing::info!(
                                    "Using ProxyPool proxy ID: {} for account: {}",
                                    proxy_cfg.entry_id,
                                    acc_id
                                );
                                return client;
                            }
                            Err(e) => {
                                tracing::error!("Failed to build client for proxy {}: {}, falling back to default", proxy_cfg.entry_id, e);
                            }
                        }
                    }
                    Ok(None) => {
                        // No proxy found or required for this account, use default
                    }
                    Err(e) => {
                        tracing::error!(
                            "Error getting proxy for account {}: {}, falling back to default",
                            acc_id,
                            e
                        );
                    }
                }
            }
        }
        // Fallback to default client
        self.default_client.clone()
    }

    /// Build v1internal URL
    fn build_url(base_url: &str, method: &str, query_string: Option<&str>) -> String {
        if let Some(qs) = query_string {
            format!("{}:{}?{}", base_url, method, qs)
        } else {
            format!("{}:{}", base_url, method)
        }
    }

    /// Determine if we should try next endpoint (fallback logic)
    fn should_try_next_endpoint(status: StatusCode) -> bool {
        status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::REQUEST_TIMEOUT
            || status == StatusCode::NOT_FOUND
            || status.is_server_error()
    }

    /// Call v1internal API (Basic Method)
    ///
    /// Initiates a basic network request, supporting multi-endpoint auto-fallback.
    /// [UPDATED] Takes optional account_id for per-account proxy selection.
    pub async fn call_v1_internal(
        &self,
        method: &str,
        access_token: &str,
        body: Value,
        query_string: Option<&str>,
        account_id: Option<&str>, // [NEW] Account ID for proxy selection
    ) -> Result<UpstreamCallResult, String> {
        self.call_v1_internal_with_headers(
            method,
            access_token,
            body,
            query_string,
            std::collections::HashMap::new(),
            account_id,
        )
        .await
    }

    /// [FIX #765] 调用 v1internal API，支持透传额外的 Headers
    /// [ENHANCED] 返回 UpstreamCallResult，包含降级尝试记录，用于 debug 日志
    pub async fn call_v1_internal_with_headers(
        &self,
        method: &str,
        access_token: &str,
        body: Value,
        query_string: Option<&str>,
        extra_headers: std::collections::HashMap<String, String>,
        account_id: Option<&str>, // [NEW] Account ID
    ) -> Result<UpstreamCallResult, String> {
        // [NEW] Get client based on account (cached in proxy pool manager)
        let client = self.get_client(account_id).await;

        // 构建 Headers (所有端点复用)
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        headers.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&format!("Bearer {}", access_token))
                .map_err(|e| e.to_string())?,
        );

        headers.insert(
            header::USER_AGENT,
            header::HeaderValue::from_str(&self.get_user_agent().await).unwrap_or_else(|e| {
                tracing::warn!("Invalid User-Agent header value, using fallback: {}", e);
                header::HeaderValue::from_static("antigravity")
            }),
        );

        // [ENHANCED] 注入 Antigravity 官方客户端关键特征 Headers
        // 1. Client Identity
        headers.insert(
            "x-client-name",
            header::HeaderValue::from_static("antigravity"),
        );
        if let Ok(ver) = header::HeaderValue::from_str(&crate::constants::CURRENT_VERSION) {
            headers.insert("x-client-version", ver);
        }

        // 2. Device & Session Identity
        // Machine ID (Persistent)
        if let Ok(mid) = machine_uid::get() {
             if let Ok(mid_val) = header::HeaderValue::from_str(&mid) {
                 headers.insert("x-machine-id", mid_val);
             }
        }
        // Session ID (Per App Launch)
        if let Ok(sess_val) = header::HeaderValue::from_str(&crate::constants::SESSION_ID) {
            headers.insert("x-vscode-sessionid", sess_val);
        }

        // [REMOVED v4.1.24] x-goog-api-client (gl-node/fire/grpc) header has been removed.
        // This header belongs to the IDE's JS layer, not the official client's egress.
        // Sending it creates a contradictory "Electron + Node.js" fingerprint.

        // 注入额外的 Headers (如 anthropic-beta)
        for (k, v) in extra_headers {
            if let Ok(hk) = header::HeaderName::from_bytes(k.as_bytes()) {
                if let Ok(hv) = header::HeaderValue::from_str(&v) {
                    headers.insert(hk, hv);
                }
            }
        }

        // [DEBUG] Log headers for verification
        tracing::debug!(?headers, "Final Upstream Request Headers");

        let mut fallback_attempts: Vec<FallbackAttemptLog> = Vec::new();

        // --- [OPTIMIZED] 端点健康记忆：优先尝试上次成功的端点（避免不必要的并发连接） ---
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as usize;
        let last_success_at = self.last_success_time.load(Ordering::Relaxed);
        let preferred_idx = self.last_successful_endpoint.load(Ordering::Relaxed);
        let has_valid_memory = last_success_at > 0
            && now_secs.saturating_sub(last_success_at) < 60
            && preferred_idx < V1_INTERNAL_BASE_URL_FALLBACKS.len();

        if has_valid_memory {
            let base_url = V1_INTERNAL_BASE_URL_FALLBACKS[preferred_idx];
            let url = Self::build_url(base_url, method, query_string);

            match client.post(&url).headers(headers.clone()).json(&body).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        self.last_success_time.store(now_secs, Ordering::Relaxed);
                        tracing::debug!("✓ Upstream via preferred [{}]: {}", preferred_idx, base_url);
                        return Ok(UpstreamCallResult { response: resp, fallback_attempts });
                    }
                    if !Self::should_try_next_endpoint(status) {
                        // 不可重试错误（如 401/403），所有端点结果相同，直接返回
                        return Ok(UpstreamCallResult { response: resp, fallback_attempts });
                    }
                    let err_msg = format!("Preferred endpoint {} returned {}", base_url, status);
                    tracing::warn!("{}", err_msg);
                    fallback_attempts.push(FallbackAttemptLog {
                        endpoint_url: url, status: Some(status.as_u16()), error: err_msg,
                    });
                }
                Err(e) => {
                    let msg = format!("Preferred endpoint {} connect failed: {}", base_url, e);
                    tracing::warn!("{}", msg);
                    fallback_attempts.push(FallbackAttemptLog {
                        endpoint_url: url, status: None, error: msg,
                    });
                }
            }
            tracing::info!("Preferred endpoint [{}] failed, racing all endpoints concurrently", preferred_idx);
        }

        // --- [OPTIMIZED] 并发竞速：同时向所有端点发请求，第一个成功即返回，其余自动取消 ---
        let urls: [String; 3] = [
            Self::build_url(V1_INTERNAL_BASE_URL_FALLBACKS[0], method, query_string),
            Self::build_url(V1_INTERNAL_BASE_URL_FALLBACKS[1], method, query_string),
            Self::build_url(V1_INTERNAL_BASE_URL_FALLBACKS[2], method, query_string),
        ];

        let f0 = client.post(&urls[0]).headers(headers.clone()).json(&body).send();
        let f1 = client.post(&urls[1]).headers(headers.clone()).json(&body).send();
        let f2 = client.post(&urls[2]).headers(headers.clone()).json(&body).send();
        tokio::pin!(f0, f1, f2);

        let mut done = [false; 3];
        let mut last_retryable_resp: Option<Response> = None;

        for _ in 0..3 {
            let (idx, result) = tokio::select! {
                r = &mut f0, if !done[0] => { done[0] = true; (0usize, r) }
                r = &mut f1, if !done[1] => { done[1] = true; (1usize, r) }
                r = &mut f2, if !done[2] => { done[2] = true; (2usize, r) }
            };

            let base_url = V1_INTERNAL_BASE_URL_FALLBACKS[idx];

            match result {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        // 成功！更新健康记忆，剩余 future drop 时自动取消
                        self.last_successful_endpoint.store(idx, Ordering::Relaxed);
                        self.last_success_time.store(now_secs, Ordering::Relaxed);
                        if fallback_attempts.is_empty() {
                            tracing::debug!("✓ Upstream succeeded [{}]: {}", idx, base_url);
                        } else {
                            tracing::info!(
                                "✓ Upstream race winner [{}]: {} (after {} failed attempts)",
                                idx, base_url, fallback_attempts.len()
                            );
                        }
                        return Ok(UpstreamCallResult { response: resp, fallback_attempts });
                    }
                    if !Self::should_try_next_endpoint(status) {
                        return Ok(UpstreamCallResult { response: resp, fallback_attempts });
                    }
                    // 可重试错误，记录并等待其他端点结果
                    let err_msg = format!("Endpoint [{}] {} returned {}", idx, base_url, status);
                    tracing::warn!("{}", err_msg);
                    fallback_attempts.push(FallbackAttemptLog {
                        endpoint_url: urls[idx].clone(),
                        status: Some(status.as_u16()),
                        error: err_msg,
                    });
                    last_retryable_resp = Some(resp);
                }
                Err(e) => {
                    let msg = format!("Endpoint [{}] {} connect failed: {}", idx, base_url, e);
                    tracing::debug!("{}", msg);
                    fallback_attempts.push(FallbackAttemptLog {
                        endpoint_url: urls[idx].clone(),
                        status: None,
                        error: msg,
                    });
                }
            }
        }

        // 所有端点都失败
        if let Some(resp) = last_retryable_resp {
            // 返回最后一个可重试响应，让上层处理（如 429 触发账号轮换）
            Ok(UpstreamCallResult { response: resp, fallback_attempts })
        } else {
            Err(fallback_attempts.last()
                .map(|a| a.error.clone())
                .unwrap_or_else(|| "All endpoints failed".to_string()))
        }
    }

    /// 调用 v1internal API（带 429 重试,支持闭包）
    ///
    /// 带容错和重试的核心请求逻辑
    ///
    /// # Arguments
    /// * `method` - API method (e.g., "generateContent")
    /// * `query_string` - Optional query string (e.g., "?alt=sse")
    /// * `get_credentials` - 闭包，获取凭证（支持账号轮换）
    /// * `build_body` - 闭包，接收 project_id 构建请求体
    /// * `max_attempts` - 最大重试次数
    ///
    /// # Returns
    /// HTTP Response
    // 已移除弃用的重试方法 (call_v1_internal_with_retry)

    // 已移除弃用的辅助方法 (parse_retry_delay)

    // 已移除弃用的辅助方法 (parse_duration_ms)

    /// 获取可用模型列表
    ///
    /// 获取远端模型列表，支持多端点自动 Fallback
    #[allow(dead_code)] // API ready for future model discovery feature
    pub async fn fetch_available_models(
        &self,
        access_token: &str,
        account_id: Option<&str>,
    ) -> Result<Value, String> {
        // 复用 call_v1_internal，然后解析 JSON
        let result = self
            .call_v1_internal(
                "fetchAvailableModels",
                access_token,
                serde_json::json!({}),
                None,
                account_id,
            )
            .await?;
        let json: Value = result
            .response
            .json()
            .await
            .map_err(|e| format!("Parse json failed: {}", e))?;
        Ok(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_url() {
        let base_url = "https://cloudcode-pa.googleapis.com/v1internal";

        let url1 = UpstreamClient::build_url(base_url, "generateContent", None);
        assert_eq!(
            url1,
            "https://cloudcode-pa.googleapis.com/v1internal:generateContent"
        );

        let url2 = UpstreamClient::build_url(base_url, "streamGenerateContent", Some("alt=sse"));
        assert_eq!(
            url2,
            "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"
        );
    }
}
