//! Dev-only: serve git/fs commands over HTTP for browser-based UI testing (see src/devbridge.rs).
#[tokio::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("DEVBRIDGE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(1430);
    devcat_lib::devbridge::serve(port).await
}
