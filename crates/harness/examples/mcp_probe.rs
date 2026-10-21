//! List the MCP servers DevCat Agent would use for a folder, and their tools (development only):
//! `cargo run --example mcp_probe -- <folder>`
use devcat_harness::mcp::connect_all;
use devcat_harness::prompt::home_dir;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cwd = std::path::PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| ".".into()));
    let (servers, errors) = connect_all(&cwd, home_dir().as_deref()).await;
    for s in &servers {
        println!("{}: {} tools ({})", s.name, s.tools.len(), s.tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(", "));
    }
    for e in errors {
        println!("! {e}");
    }
}
