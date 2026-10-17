use std::path::Path;

fn main() {
    embed_mobile_web();
    tauri_build::build()
}

/// The browser version of DevCat Mobile (`pnpm mobile:web` → mobile/dist-web) is served by the
/// remote-access server; embed whatever was built (an empty list when it wasn't).
fn embed_mobile_web() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile/dist-web");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files = Vec::new();
    collect(&dir, &dir, &mut files);
    files.sort();
    let mut out = String::from("/// (path, bytes) of the built mobile web app.\npub static FILES: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in &files {
        println!("cargo:rerun-if-changed={abs}");
        out.push_str(&format!("    ({rel:?}, include_bytes!({abs:?})),\n"));
    }
    out.push_str("];\n");
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("mobile_web.rs");
    std::fs::write(dest, out).unwrap();
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(root, &p, out);
        } else if let Ok(rel) = p.strip_prefix(root) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            out.push((format!("/{rel}"), p.canonicalize().unwrap_or(p.clone()).to_string_lossy().into_owned()));
        }
    }
}
