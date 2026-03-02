use tauri::State;
use crate::modules::zeabur::{ZeaburConfig, ZeaburManager, ZeaburStatus};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Zeabur 云端服务状态管理
#[derive(Clone)]
pub struct ZeaburState {
    pub manager: Arc<RwLock<ZeaburManager>>,
}

impl ZeaburState {
    pub fn new() -> Self {
        Self {
            manager: Arc::new(RwLock::new(ZeaburManager::new())),
        }
    }
}

/// 连接到 Zeabur 云端实例
#[tauri::command]
pub async fn zeabur_connect(
    state: State<'_, ZeaburState>,
    config: ZeaburConfig,
) -> Result<ZeaburStatus, String> {
    let manager = state.manager.read().await;
    manager.connect(config).await
}

/// 断开 Zeabur 云端实例连接
#[tauri::command]
pub async fn zeabur_disconnect(
    state: State<'_, ZeaburState>,
) -> Result<ZeaburStatus, String> {
    let manager = state.manager.read().await;
    Ok(manager.disconnect().await)
}

/// 手动触发一次账号同步
#[tauri::command]
pub async fn zeabur_sync_accounts(
    state: State<'_, ZeaburState>,
) -> Result<ZeaburStatus, String> {
    let manager = state.manager.read().await;
    manager.sync_accounts().await
}

/// 获取 Zeabur 连接状态
#[tauri::command]
pub async fn zeabur_get_status(
    state: State<'_, ZeaburState>,
) -> Result<ZeaburStatus, String> {
    let manager = state.manager.read().await;
    Ok(manager.get_status().await)
}

/// 快速测试连接是否可达
#[tauri::command]
pub async fn zeabur_test_connection(
    url: String,
    api_key: String,
) -> Result<bool, String> {
    ZeaburManager::test_connection(&url, &api_key).await
}
