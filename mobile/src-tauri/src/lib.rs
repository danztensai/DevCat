//! DevCat Mobile: a remote control for DevCat on your computer. The phone keeps only its key
//! and the list of paired computers; every request goes to a computer and runs there.
//!
//! Commands (all errors are user-facing strings):
//!   m_info, m_set_name, m_machines, m_pair, m_call, m_connect, m_disconnect, m_forget,
//!   m_set_addrs, m_network_changed
//! Events: `m-conn` ({ id, state: connecting|online|offline, error? }),
//!         `m-event` ({ id, event, payload }), `m-pair` ({ stage, hostName }).
pub mod client;
pub mod store;

use client::{Client, Hello};
use serde_json::{Value, json};
use std::sync::Arc;
use store::{Machine, Prefs, Store};
use tauri::{Emitter, Manager, State};

pub fn platform() -> &'static str {
    if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "android") {
        "android"
    } else {
        std::env::consts::OS
    }
}

fn default_name() -> String {
    match platform() {
        "ios" => "iPhone".into(),
        "android" => "Android phone".into(),
        os => format!("DevCat Mobile ({os})"),
    }
}

pub struct App {
    pub client: Arc<Client>,
    pub store: Arc<Store>,
}

#[tauri::command]
fn m_info(app: State<'_, App>, handle: tauri::AppHandle) -> Value {
    let h = app.client.hello();
    json!({
        "deviceId": app.client.device_id(),
        "deviceName": h.name,
        "platform": platform(),
        "version": handle.package_info().version.to_string(),
        "online": app.client.online(),
    })
}

#[tauri::command]
fn m_set_name(app: State<'_, App>, name: String) -> Result<(), String> {
    let name: String = name.trim().chars().take(60).collect();
    if name.is_empty() {
        return Err("Enter a name".into());
    }
    app.store.save_prefs(&Prefs { device_name: Some(name.clone()) })?;
    app.client.set_name(name);
    Ok(())
}

#[tauri::command]
fn m_machines(app: State<'_, App>) -> Vec<Machine> {
    app.store.machines()
}

#[tauri::command]
async fn m_pair(app: State<'_, App>, link: String, addr: Option<String>) -> Result<Machine, String> {
    app.client.pair(&link, addr).await
}

#[tauri::command]
async fn m_connect(app: State<'_, App>, id: String) -> Result<Value, String> {
    let s = app.client.session(&id).await?;
    Ok(json!({ "host": s.host, "device": s.device }))
}

#[tauri::command]
async fn m_call(app: State<'_, App>, id: String, cmd: String, args: Option<Value>) -> Result<Value, Value> {
    app.client.call(&id, &cmd, args.unwrap_or(Value::Null)).await
}

#[tauri::command]
fn m_disconnect(app: State<'_, App>, id: String) {
    app.client.disconnect(&id);
}

#[tauri::command]
fn m_forget(app: State<'_, App>, id: String) -> Result<Vec<Machine>, String> {
    app.client.forget(&id)?;
    Ok(app.store.machines())
}

/// Addresses the user typed for a computer (tried before the ones it reports).
#[tauri::command]
fn m_set_addrs(app: State<'_, App>, id: String, addrs: Vec<String>) -> Result<Vec<Machine>, String> {
    let manual: Vec<String> = addrs.into_iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect();
    app.store.update(&id, |m| {
        let reported: Vec<String> = m.addrs.iter().filter(|a| !m.manual_addrs.contains(a)).cloned().collect();
        m.addrs = store::merged_addrs(&manual, &reported);
        m.manual_addrs = manual;
    })?;
    app.client.disconnect(&id);
    Ok(app.store.machines())
}

#[tauri::command]
async fn m_network_changed(app: State<'_, App>) -> Result<(), String> {
    app.client.network_changed().await;
    Ok(())
}

/// The same commands without Tauri, for the browser bridge (examples/bridge.rs).
pub async fn bridge_call(app: &App, version: &str, cmd: &str, args: Value) -> Result<Value, Value> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string);
    let req = |k: &str| s(k).ok_or_else(|| json!(format!("missing {k}")));
    let ok = |v: Result<Value, String>| v.map_err(Value::String);
    match cmd {
        "m_info" => {
            let h = app.client.hello();
            Ok(json!({ "deviceId": app.client.device_id(), "deviceName": h.name, "platform": platform(), "version": version, "online": app.client.online() }))
        }
        "m_set_name" => {
            let name = req("name")?;
            app.store.save_prefs(&Prefs { device_name: Some(name.clone()) }).map_err(Value::String)?;
            app.client.set_name(name);
            Ok(Value::Null)
        }
        "m_machines" => Ok(json!(app.store.machines())),
        "m_pair" => ok(app.client.pair(&req("link")?, s("addr")).await.map(|m| json!(m))),
        "m_connect" => ok(app.client.session(&req("id")?).await.map(|s| json!({ "host": s.host, "device": s.device }))),
        "m_call" => app.client.call(&req("id")?, &req("cmd")?, args.get("args").cloned().unwrap_or(Value::Null)).await,
        "m_disconnect" => {
            app.client.disconnect(&req("id")?);
            Ok(Value::Null)
        }
        "m_forget" => {
            app.client.forget(&req("id")?).map_err(Value::String)?;
            Ok(json!(app.store.machines()))
        }
        "m_set_addrs" => {
            let id = req("id")?;
            let manual: Vec<String> = serde_json::from_value(args["addrs"].clone()).unwrap_or_default();
            app.store
                .update(&id, |m| {
                    let reported: Vec<String> = m.addrs.iter().filter(|a| !m.manual_addrs.contains(a)).cloned().collect();
                    m.addrs = store::merged_addrs(&manual, &reported);
                    m.manual_addrs = manual.clone();
                })
                .map_err(Value::String)?;
            app.client.disconnect(&id);
            Ok(json!(app.store.machines()))
        }
        "m_network_changed" => {
            app.client.network_changed().await;
            Ok(Value::Null)
        }
        _ => Err(json!(format!("unknown command {cmd}"))),
    }
}

/// A phone-side app outside Tauri (browser bridge, tests).
pub fn headless(dir: std::path::PathBuf, name: &str, sink: client::Sink) -> Result<App, String> {
    let store = Arc::new(Store::new(dir));
    let name = store.prefs().device_name.unwrap_or_else(|| name.to_string());
    let client = Client::new(store.clone(), sink, Hello { name, platform: "web".into(), app_version: "dev".into() })?;
    Ok(App { client, store })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg_attr(not(mobile), allow(unused_mut))]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // devcat://pair?… links (from the web page's "Open in DevCat app") open the pairing screen.
        .plugin(tauri_plugin_deep_link::init());
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    }
    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Arc::new(Store::new(dir));
            let handle = app.handle().clone();
            let sink: client::Sink = Arc::new(move |event, payload| {
                let _ = handle.emit(event, payload);
            });
            let name = store.prefs().device_name.unwrap_or_else(default_name);
            let hello = Hello { name, platform: platform().into(), app_version: app.package_info().version.to_string() };
            let client = Client::new(store.clone(), sink, hello)?;
            app.manage(App { client, store });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![m_info, m_set_name, m_machines, m_pair, m_connect, m_call, m_disconnect, m_forget, m_set_addrs, m_network_changed])
        .run(tauri::generate_context!())
        .expect("error while running DevCat Mobile");
}
