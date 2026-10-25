//! Everything that is about the A2 Tools DPS Meter, in one place. When the project has its own DPS
//! meter and A2 Tools support is dropped, this folder goes, with web/source-a2.js, the plugin's
//! bridge.js and the installer's A2 Tools step (see the A2 Tools lines in installer/setup.nsi).
//!
//! - The plugin (plugin/farm-guide, inside A2 Tools) writes its records as files under
//!   %APPDATA%\com.a2tools.dps-meter\plugin-data\farm-guide. We watch its bridge.json and pass each
//!   change to the page; we write only overlay.json there (our heartbeat), see main.rs write_file.
//! - Ctrl+Alt+L is A2 Tools' own lock key: we follow its lock through its settings file.
//! - setup.rs adds the plugin folder to A2 Tools for the installer.

pub mod setup;
pub mod setup_core;

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

const PLUGIN_ID: &str = "farm-guide";

/// The plugin's storage folder in A2 Tools (`FG_PLUGIN_DIR` replaces it, for tests).
pub fn plugin_dir() -> PathBuf {
    std::env::var_os("FG_PLUGIN_DIR").map(PathBuf::from).unwrap_or_else(|| {
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        appdata.join("com.a2tools.dps-meter").join("plugin-data").join(PLUGIN_ID)
    })
}

/// The watchers: the bridge and A2 Tools' lock.
pub fn start(app: &AppHandle) {
    let _ = std::fs::create_dir_all(plugin_dir());
    let h = app.clone();
    std::thread::spawn(move || watch_bridge(h));
    let h = app.clone();
    std::thread::spawn(move || watch_lock(h));
}

/// Pass each new version of the plugin's bridge.json to the page.
fn watch_bridge(app: AppHandle) {
    let path = plugin_dir().join("bridge.json");
    let mut last: Option<(SystemTime, u64)> = None;
    loop {
        std::thread::sleep(Duration::from_millis(80));
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let stamp = (meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), meta.len());
        if last == Some(stamp) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            // a half-written file fails to parse in the page; it then waits for the next change
            if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                last = Some(stamp);
                let _ = app.emit("bridge", text);
            }
        }
    }
}

pub fn locked() -> Option<bool> {
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from)?;
    let text = std::fs::read_to_string(appdata.join("com.a2tools.dps-meter").join("settings.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    match v.get("dpsMeter.overlayLocked")? {
        serde_json::Value::Bool(b) => Some(*b),
        serde_json::Value::String(s) => Some(s == "true"),
        _ => None,
    }
}

/// Ctrl+Alt+L is A2 Tools' lock key (whatever key it's set to, in fact): when A2 Tools' lock changes,
/// it saves it to its settings, and we follow, so one press locks both. Nothing of ours reads the
/// keyboard.
fn watch_lock(app: AppHandle) {
    let Some(path) = std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("com.a2tools.dps-meter").join("settings.json")) else { return };
    let mut stamp: Option<SystemTime> = None;
    let mut last = locked();
    loop {
        std::thread::sleep(Duration::from_millis(250));
        let Ok(modified) = std::fs::metadata(&path).and_then(|m| m.modified()) else { continue };
        if stamp == Some(modified) {
            continue;
        }
        stamp = Some(modified);
        let now = locked();
        if now.is_some() && now != last {
            let _ = app.emit("hotkey-lock", now);
        }
        if now.is_some() {
            last = now;
        }
    }
}

/// Where A2 Tools loads Farm Guide from a folder (developer mode), and that copy's version.
pub fn plugin_folder() -> Option<(PathBuf, String)> {
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from)?;
    let text = std::fs::read_to_string(appdata.join("com.a2tools.dps-meter").join("settings.json")).ok()?;
    let settings: Value = serde_json::from_str(&text).ok()?;
    let folders: Vec<String> = match settings.get("dpsMeter.devPlugins")? {
        Value::String(s) => serde_json::from_str(s).ok()?,
        Value::Array(a) => a.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        _ => return None,
    };
    folders.into_iter().map(PathBuf::from).find_map(|dir| {
        let m: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).ok()?).ok()?;
        if m.get("id")?.as_str()? != PLUGIN_ID {
            return None;
        }
        let version = m.get("version")?.as_str()?.to_string();
        Some((dir, version))
    })
}
