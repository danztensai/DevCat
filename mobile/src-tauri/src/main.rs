// Prevents an extra console window on Windows in release (desktop builds are for development).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    devcat_mobile_lib::run()
}
