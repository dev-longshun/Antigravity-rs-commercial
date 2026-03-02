use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

// ============================================================================
// Zeabur 配置与状态结构体
// ============================================================================

/// Zeabur 云端部署配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZeaburConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Zeabur 实例地址，如 https://xxx.zeabur.app
    #[serde(default)]
    pub instance_url: String,
    /// 云端实例的 API_KEY（用于认证账号同步请求）
    #[serde(default)]
    pub api_key: String,
    /// 是否自动同步账号池
    #[serde(default)]
    pub auto_sync: bool,
    /// 同步间隔（秒），默认 300（5 分钟）
    #[serde(default = "default_sync_interval")]
    pub sync_interval_secs: u64,
}

fn default_sync_interval() -> u64 {
    300
}

impl Default for ZeaburConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            instance_url: String::new(),
            api_key: String::new(),
            auto_sync: false,
            sync_interval_secs: default_sync_interval(),
        }
    }
}

/// Zeabur 云端实例状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZeaburStatus {
    pub connected: bool,
    pub instance_url: Option<String>,
    pub version: Option<String>,
    pub accounts_synced: u32,
    pub last_sync_time: Option<i64>,
    pub error: Option<String>,
}

impl Default for ZeaburStatus {
    fn default() -> Self {
        Self {
            connected: false,
            instance_url: None,
            version: None,
            accounts_synced: 0,
            last_sync_time: None,
            error: None,
        }
    }
}

// ============================================================================
// 同步协议数据结构
// ============================================================================

/// 同步请求中的单个账号数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAccountEntry {
    pub id: String,
    pub email: String,
    pub token: SyncTokenData,
    #[serde(default)]
    pub proxy_disabled: bool,
    pub custom_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncTokenData {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub expiry_timestamp: i64,
}

/// 同步请求体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAccountsRequest {
    pub accounts: Vec<SyncAccountEntry>,
}

/// 同步响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAccountsResponse {
    pub success: bool,
    pub added: u32,
    pub updated: u32,
    pub removed: u32,
    pub failed: u32,
    pub error: Option<String>,
}

/// 云端实例状态响应（GET /api/sync/status）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteStatusResponse {
    pub version: Option<String>,
    pub accounts_count: u32,
    pub running: bool,
}

// ============================================================================
// ZeaburManager — 管理云端实例连接与账号同步
// ============================================================================

pub struct ZeaburManager {
    config: Arc<RwLock<ZeaburConfig>>,
    status: Arc<RwLock<ZeaburStatus>>,
    client: reqwest::Client,
    /// 用于停止自动同步任务
    auto_sync_shutdown: RwLock<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl ZeaburManager {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            config: Arc::new(RwLock::new(ZeaburConfig::default())),
            status: Arc::new(RwLock::new(ZeaburStatus::default())),
            client,
            auto_sync_shutdown: RwLock::new(None),
        }
    }

    /// 验证云端实例是否可达并建立连接
    pub async fn connect(&self, config: ZeaburConfig) -> Result<ZeaburStatus, String> {
        let url = normalize_url(&config.instance_url);
        info!("[zeabur] Connecting to instance: {}", url);

        // 测试连接
        let status_url = format!("{}/api/sync/status", url);
        match self
            .client
            .get(&status_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .send()
            .await
        {
            Ok(resp) => {
                if !resp.status().is_success() {
                    let err = format!("HTTP {}", resp.status());
                    error!("[zeabur] Connect failed: {}", err);
                    let mut s = self.status.write().await;
                    s.connected = false;
                    s.error = Some(err.clone());
                    return Err(err);
                }

                let remote: RemoteStatusResponse = resp
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse status response: {}", e))?;

                // 更新配置和状态
                *self.config.write().await = config.clone();

                let mut s = self.status.write().await;
                s.connected = true;
                s.instance_url = Some(url.clone());
                s.version = remote.version;
                s.accounts_synced = remote.accounts_count;
                s.error = None;

                info!(
                    "[zeabur] Connected successfully, remote accounts: {}",
                    remote.accounts_count
                );

                // 启动自动同步（如果配置开启）
                if config.auto_sync {
                    drop(s); // 释放锁
                    self.start_auto_sync().await;
                }

                Ok(self.status.read().await.clone())
            }
            Err(e) => {
                let err = format!("Connection failed: {}", e);
                error!("[zeabur] {}", err);
                let mut s = self.status.write().await;
                s.connected = false;
                s.error = Some(err.clone());
                Err(err)
            }
        }
    }

    /// 断开连接
    pub async fn disconnect(&self) -> ZeaburStatus {
        info!("[zeabur] Disconnecting...");
        self.stop_auto_sync().await;

        let mut s = self.status.write().await;
        s.connected = false;
        s.instance_url = None;
        s.version = None;
        s.accounts_synced = 0;
        s.error = None;
        s.clone()
    }

    /// 从本地 DB 读取账号 → POST /api/sync/accounts 到云端
    pub async fn sync_accounts(&self) -> Result<ZeaburStatus, String> {
        let config = self.config.read().await.clone();
        if config.instance_url.is_empty() {
            return Err("Not connected to any instance".to_string());
        }

        let url = normalize_url(&config.instance_url);
        info!("[zeabur] Syncing accounts to {}", url);

        // 1. 从本地读取所有账号
        let accounts = crate::modules::account::list_accounts()
            .map_err(|e| format!("Failed to list local accounts: {}", e))?;

        // 2. 转换为同步格式
        let sync_entries: Vec<SyncAccountEntry> = accounts
            .into_iter()
            .map(|acc| SyncAccountEntry {
                id: acc.id,
                email: acc.email,
                token: SyncTokenData {
                    access_token: acc.token.access_token,
                    refresh_token: acc.token.refresh_token,
                    expires_in: acc.token.expires_in,
                    expiry_timestamp: acc.token.expiry_timestamp,
                },
                proxy_disabled: acc.proxy_disabled,
                custom_label: acc.custom_label,
            })
            .collect();

        let count = sync_entries.len();
        info!("[zeabur] Sending {} accounts to cloud instance", count);

        // 3. POST 到云端
        let sync_url = format!("{}/api/sync/accounts", url);
        let request_body = SyncAccountsRequest {
            accounts: sync_entries,
        };

        match self
            .client
            .post(&sync_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&request_body)
            .send()
            .await
        {
            Ok(resp) => {
                if !resp.status().is_success() {
                    let status_code = resp.status();
                    let body = resp
                        .text()
                        .await
                        .unwrap_or_else(|_| "Unknown error".to_string());
                    let err = format!("Sync failed: HTTP {} - {}", status_code, body);
                    error!("[zeabur] {}", err);
                    let mut s = self.status.write().await;
                    s.error = Some(err.clone());
                    return Err(err);
                }

                let sync_result: SyncAccountsResponse = resp
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse sync response: {}", e))?;

                let mut s = self.status.write().await;
                s.accounts_synced = count as u32;
                s.last_sync_time = Some(chrono::Utc::now().timestamp());
                s.error = if sync_result.failed > 0 {
                    Some(format!("{} accounts failed to sync", sync_result.failed))
                } else {
                    None
                };

                info!(
                    "[zeabur] Sync completed: added={}, updated={}, removed={}, failed={}",
                    sync_result.added,
                    sync_result.updated,
                    sync_result.removed,
                    sync_result.failed
                );

                Ok(s.clone())
            }
            Err(e) => {
                let err = format!("Sync request failed: {}", e);
                error!("[zeabur] {}", err);
                let mut s = self.status.write().await;
                s.error = Some(err.clone());
                Err(err)
            }
        }
    }

    /// 获取当前状态
    pub async fn get_status(&self) -> ZeaburStatus {
        self.status.read().await.clone()
    }

    /// 启动定时自动同步
    pub async fn start_auto_sync(&self) {
        // 先停止已有任务
        self.stop_auto_sync().await;

        let config = self.config.read().await.clone();
        let interval = config.sync_interval_secs.max(60); // 最少 60 秒

        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        *self.auto_sync_shutdown.write().await = Some(tx);

        let config_ref = self.config.clone();
        let status_ref = self.status.clone();
        let client = self.client.clone();

        info!(
            "[zeabur] Starting auto sync, interval: {}s",
            interval
        );

        tokio::spawn(async move {
            let mut timer = tokio::time::interval(tokio::time::Duration::from_secs(interval));
            timer.tick().await; // 跳过第一次立即触发

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        debug!("[zeabur] Auto sync task shutdown");
                        break;
                    }
                    _ = timer.tick() => {
                        let cfg = config_ref.read().await.clone();
                        if cfg.instance_url.is_empty() || cfg.api_key.is_empty() {
                            continue;
                        }

                        debug!("[zeabur] Auto sync triggered");

                        // 读取本地账号
                        let accounts = match crate::modules::account::list_accounts() {
                            Ok(a) => a,
                            Err(e) => {
                                warn!("[zeabur] Auto sync: failed to list accounts: {}", e);
                                continue;
                            }
                        };

                        let sync_entries: Vec<SyncAccountEntry> = accounts
                            .into_iter()
                            .map(|acc| SyncAccountEntry {
                                id: acc.id,
                                email: acc.email,
                                token: SyncTokenData {
                                    access_token: acc.token.access_token,
                                    refresh_token: acc.token.refresh_token,
                                    expires_in: acc.token.expires_in,
                                    expiry_timestamp: acc.token.expiry_timestamp,
                                },
                                proxy_disabled: acc.proxy_disabled,
                                custom_label: acc.custom_label,
                            })
                            .collect();

                        let count = sync_entries.len();
                        let url = normalize_url(&cfg.instance_url);
                        let sync_url = format!("{}/api/sync/accounts", url);

                        let request_body = SyncAccountsRequest { accounts: sync_entries };

                        match client
                            .post(&sync_url)
                            .header("Authorization", format!("Bearer {}", cfg.api_key))
                            .json(&request_body)
                            .send()
                            .await
                        {
                            Ok(resp) if resp.status().is_success() => {
                                let mut s = status_ref.write().await;
                                s.accounts_synced = count as u32;
                                s.last_sync_time = Some(chrono::Utc::now().timestamp());
                                s.error = None;
                                debug!("[zeabur] Auto sync completed: {} accounts", count);
                            }
                            Ok(resp) => {
                                let code = resp.status();
                                warn!("[zeabur] Auto sync failed: HTTP {}", code);
                                let mut s = status_ref.write().await;
                                s.error = Some(format!("Auto sync failed: HTTP {}", code));
                            }
                            Err(e) => {
                                warn!("[zeabur] Auto sync request error: {}", e);
                                let mut s = status_ref.write().await;
                                s.error = Some(format!("Auto sync error: {}", e));
                            }
                        }
                    }
                }
            }
        });
    }

    /// 停止自动同步
    pub async fn stop_auto_sync(&self) {
        if let Some(tx) = self.auto_sync_shutdown.write().await.take() {
            let _ = tx.send(());
            info!("[zeabur] Auto sync stopped");
        }
    }

    /// 快速测试连接是否可达
    pub async fn test_connection(url: &str, api_key: &str) -> Result<bool, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let normalized = normalize_url(url);
        let status_url = format!("{}/api/sync/status", normalized);

        match client
            .get(&status_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
        {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(e) => Err(format!("Connection test failed: {}", e)),
        }
    }
}

/// 规范化 URL：去掉尾部斜杠
fn normalize_url(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}
