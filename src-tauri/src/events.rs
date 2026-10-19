//! Backend → frontend events. With a window (the app) they go to the webviews through Tauri;
//! without one (`devcat serve`) only to the paired phones. Either way the remote module sees
//! every event (`add_tap`) and mirrors the ones phones use.
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
#[cfg(feature = "gui")]
use tauri::{AppHandle, Emitter};

#[cfg(feature = "gui")]
static APP: OnceCell<AppHandle> = OnceCell::new();
type Tap = Box<dyn Fn(&str, &Value) + Send + Sync>;
static TAPS: RwLock<Vec<Tap>> = RwLock::new(Vec::new());

/// Where streamed events (terminal output, Claude runs, k8s logs) go.
pub(crate) type Sink = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

/// The app is running with windows (not called in `devcat serve`).
#[cfg(feature = "gui")]
pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

#[cfg(feature = "gui")]
pub fn app() -> Option<&'static AppHandle> {
    APP.get()
}

/// Is DevCat running without windows (`devcat serve`)?
pub fn headless() -> bool {
    #[cfg(feature = "gui")]
    return APP.get().is_none();
    #[cfg(not(feature = "gui"))]
    true
}

/// Also hand every event to `f` (the remote host forwards some to phones; `devcat serve`
/// prints some).
pub fn add_tap(f: impl Fn(&str, &Value) + Send + Sync + 'static) {
    TAPS.write().push(Box::new(f));
}

pub fn emit(event: &str, payload: impl Serialize) {
    let Ok(v) = serde_json::to_value(payload) else { return };
    for tap in TAPS.read().iter() {
        tap(event, &v);
    }
    #[cfg(feature = "gui")]
    if let Some(app) = APP.get() {
        let _ = app.emit(event, v);
    }
}

pub(crate) fn sink() -> Sink {
    Arc::new(|event, payload| emit(event, payload))
}

/// Who started a terminal / stream / cluster connection (it stops when that window closes):
/// the calling window's label as a command argument, or `Owner::phones()` for phones.
#[derive(Clone)]
pub struct Owner(pub String);

impl Owner {
    pub fn phones() -> Self {
        Owner("phones".into())
    }
    pub fn label(&self) -> &str {
        &self.0
    }
}

#[cfg(feature = "gui")]
impl<'de, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R> for Owner {
    fn from_command(c: tauri::ipc::CommandItem<'de, R>) -> Result<Self, tauri::ipc::InvokeError> {
        Ok(Owner(c.message.webview().window().label().to_string()))
    }
}
