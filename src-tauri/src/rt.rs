//! The async runtime background work runs on: Tauri's in the app, a plain tokio runtime in
//! the CLI build (no Tauri at all, see the `gui` feature).
#[cfg(feature = "gui")]
pub use tauri::async_runtime::{block_on, spawn, spawn_blocking};

#[cfg(not(feature = "gui"))]
mod plain {
    use std::future::Future;
    use std::sync::LazyLock;
    use tokio::task::JoinHandle;

    static RT: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime"));

    pub fn spawn<F: Future<Output: Send + 'static> + Send + 'static>(f: F) -> JoinHandle<F::Output> {
        RT.spawn(f)
    }

    pub fn spawn_blocking<F: FnOnce() -> R + Send + 'static, R: Send + 'static>(f: F) -> JoinHandle<R> {
        RT.spawn_blocking(f)
    }

    pub fn block_on<F: Future>(f: F) -> F::Output {
        RT.block_on(f)
    }
}

#[cfg(not(feature = "gui"))]
pub use plain::{block_on, spawn, spawn_blocking};
