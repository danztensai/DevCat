mod commands;
mod db;
mod error;
mod history;
mod infra;
mod models;
mod state;
mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("no app data dir");
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
