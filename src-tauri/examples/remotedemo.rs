//! Debug-only demo host for DevCat Mobile (made-up data, real protocol and terminals).
//! `cargo run --example remotedemo -- [port] [data dir]`; prints `PAIR devcat://pair?…`.
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port = args.get(1).and_then(|p| p.parse().ok()).unwrap_or(47199);
    let dir = args.get(2).map(std::path::PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("devcat-remotedemo"));
    if let Err(e) = devcat_lib::remotedemo::run(port, dir).await {
        eprintln!("remotedemo: {e}");
        std::process::exit(1);
    }
}
