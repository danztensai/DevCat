use crate::error::AppResult;
use crate::models::ConnectionConfig;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> AppResult<Vec<ConnectionConfig>> {
    state.store.load_all()
}

/// Returns the profile including its password (for the edit dialog).
#[tauri::command]
pub async fn get_connection(state: State<'_, AppState>, id: String) -> AppResult<ConnectionConfig> {
    state.store.get(&id)
}

#[tauri::command]
pub async fn save_connection(state: State<'_, AppState>, config: ConnectionConfig) -> AppResult<ConnectionConfig> {
    // Drop any open session so the next use picks up the new settings.
    if let Some(d) = state.sessions.write().await.remove(&config.id) {
        d.close().await;
    }
    drop_infra_clients(&config.id).await;
    let mut config = config;
    config.group = None;
    if let Some(pid) = &config.project_id {
        if !state.projects.exists(pid)? {
            config.project_id = None;
        }
    }
    state.store.save(config)
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: String) -> AppResult<()> {
    if let Some(d) = state.sessions.write().await.remove(&id) {
        d.close().await;
    }
    drop_infra_clients(&id).await;
    state.store.delete(&id)
}

/// Test an unsaved profile. Database kinds return the server version.
#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> AppResult<String> {
    crate::network::ensure_for(&config).await?;
    match config.kind {
        crate::models::ConnectionKind::Kubernetes => crate::infra::k8s::test(&config).await,
        crate::models::ConnectionKind::Rabbitmq => crate::infra::rabbitmq::test(&config).await,
        _ => {
            let d = crate::db::connect(&config).await?;
            let v = d.server_version().await;
            d.close().await;
            v
        }
    }
}

#[tauri::command]
pub async fn open_connection(state: State<'_, AppState>, id: String) -> AppResult<String> {
    let d = state.driver(&id).await?;
    d.server_version().await
}

#[tauri::command]
pub async fn close_connection(state: State<'_, AppState>, id: String) -> AppResult<()> {
    if let Some(d) = state.sessions.write().await.remove(&id) {
        d.close().await;
    }
    drop_infra_clients(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn open_connection_ids(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state.sessions.read().await.keys().cloned().collect())
}

/// Forget cached Kubernetes/RabbitMQ clients (and stop k8s streams) for a profile
/// so edited settings take effect without a manual reconnect.
pub(crate) async fn drop_infra_clients(id: &str) {
    let _ = crate::infra::k8s::k8s_disconnect(id.to_string()).await;
    crate::infra::rabbitmq::client::evict(id);
}
