mod claude;
mod commands;
mod db;
mod error;
mod history;
mod infra;
mod models;
mod network;
mod projects;
mod state;
mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Both the `ring` and `aws-lc-rs` rustls backends end up in the dependency tree,
    // so rustls can't pick one automatically; choose it once for every TLS client.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("no app data dir");
            network::init(dir.clone());
            network::start(app.handle().clone());
            app.manage(state::AppState::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // connections
            commands::connections::list_connections,
            commands::connections::get_connection,
            commands::connections::save_connection,
            commands::connections::delete_connection,
            commands::connections::test_connection,
            commands::connections::open_connection,
            commands::connections::close_connection,
            commands::connections::open_connection_ids,
            // projects
            commands::projects::list_projects,
            commands::projects::save_project,
            commands::projects::delete_project,
            commands::projects::move_connections,
            commands::projects::reorder_projects,
            // database
            commands::db::db_children,
            commands::db::db_list_databases,
            commands::db::db_execute,
            commands::db::db_cancel,
            commands::db::db_table_data,
            commands::db::db_table_structure,
            commands::db::db_apply_changes,
            commands::db::db_object_ddl,
            commands::db::db_schema_snapshot,
            commands::db::db_get_key,
            commands::db::db_set_key,
            commands::db::db_delete_key,
            // history & saved queries
            commands::history::history_list,
            commands::history::history_clear,
            commands::history::saved_queries_list,
            commands::history::saved_query_save,
            commands::history::saved_query_delete,
            // transfer
            commands::transfer::export_data,
            commands::transfer::import_data,
            commands::transfer::import_preview,
            commands::transfer::backup_database,
            commands::transfer::restore_database,
            commands::transfer::transfer_tables,
            // INFRA-COMMANDS (k8s, rabbitmq) — registered during integration
            // kubernetes
            infra::k8s::k8s_contexts,
            infra::k8s::k8s_connect,
            infra::k8s::k8s_disconnect,
            infra::k8s::k8s_namespaces,
            infra::k8s::k8s_list,
            infra::k8s::k8s_get,
            infra::k8s::k8s_get_yaml,
            infra::k8s::k8s_apply_yaml,
            infra::k8s::k8s_delete,
            infra::k8s::k8s_scale,
            infra::k8s::k8s_restart,
            infra::k8s::k8s_cronjob_suspend,
            infra::k8s::k8s_events_for,
            infra::k8s::k8s_cluster_overview,
            infra::k8s::k8s_metrics,
            infra::k8s::k8s_save_text,
            infra::k8s::streams::k8s_stream_stop,
            infra::k8s::streams::k8s_watch_start,
            infra::k8s::streams::k8s_exec_input,
            infra::k8s::streams::k8s_exec_resize,
            infra::k8s::streams::k8s_exec_stop,
            infra::k8s::streams::k8s_port_forward_list,
            infra::k8s::streams::k8s_port_forward_stop,
            infra::k8s::streams::k8s_exec_start,
            infra::k8s::streams::k8s_logs_start,
            infra::k8s::streams::k8s_port_forward_start,
            infra::k8s::helm::k8s_helm_releases,
            infra::k8s::helm::k8s_helm_release,
            // network (VPN / SSH tunnels)
            network::net_list,
            network::net_get,
            network::net_save,
            network::net_delete,
            network::net_import,
            network::net_parse,
            network::net_connect,
            network::net_disconnect,
            network::net_status,
            network::net_logs,
            network::net_tools,
            network::net_ssh_config_hosts,
            network::net_traffic,
            // claude code workspace
            claude::runner::claude_info,
            claude::runner::claude_start,
            claude::runner::claude_send,
            claude::runner::claude_permission,
            claude::runner::claude_control,
            claude::runner::claude_stop,
            claude::review::claude_review,
            claude::sessions::claude_projects,
            claude::sessions::claude_sessions,
            claude::sessions::claude_transcript,
            claude::files::fs_list,
            claude::files::fs_preview,
            claude::git::git_status,
            claude::git::git_file_versions,
            claude::git::git_diff_text,
            claude::git::git_stage,
            claude::git::git_unstage,
            claude::git::git_discard,
            claude::git::git_commit,
            // rabbitmq
            infra::rabbitmq::rmq_bindings,
            infra::rabbitmq::rmq_close_connection,
            infra::rabbitmq::rmq_create_binding,
            infra::rabbitmq::rmq_declare_exchange,
            infra::rabbitmq::rmq_declare_queue,
            infra::rabbitmq::rmq_delete_binding,
            infra::rabbitmq::rmq_delete_exchange,
            infra::rabbitmq::rmq_delete_queue,
            infra::rabbitmq::rmq_get,
            infra::rabbitmq::rmq_get_messages,
            infra::rabbitmq::rmq_list,
            infra::rabbitmq::rmq_list_page,
            infra::rabbitmq::rmq_nodes,
            infra::rabbitmq::rmq_overview,
            infra::rabbitmq::rmq_publish,
            infra::rabbitmq::rmq_purge_queue,
            infra::rabbitmq::rmq_request,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Tear down VPNs / tunnels so no elevated openvpn or wg interface outlives the app.
            if let tauri::RunEvent::Exit = event {
                network::shutdown();
            }
        });
}
