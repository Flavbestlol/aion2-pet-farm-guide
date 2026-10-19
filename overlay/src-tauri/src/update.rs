//! Updates, from the project's GitHub Releases.
//!
//! Each release carries `latest.json` (what's new, and where the overlay's exe and the plugin's zip
//! are, with their SHA-256) and `latest.json.sig`: an Ed25519 signature over those exact bytes. The
//! public key is built in below; the private key never leaves the publisher's computer. So a release
//! is installed only when it was signed by the publisher and every byte matches what they signed,
//! whoever serves the files.
//!
//! The overlay's exe is replaced next to itself (`<name>.new.exe`, then a small script swaps it in
//! once we've exited and starts the new one). The plugin is updated only where A2 Tools loads it from
//! a folder (developer mode): its files are rewritten in that folder, which A2 Tools reads from disk.
//! A plugin installed from A2 Tools' own reviewed catalog is left to A2 Tools.
//!
//! Nothing is sent anywhere: a check is two plain downloads from GitHub.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::update_core::{sha256_hex, signed, unzip_plugin, MAX_ZIP};

pub const FEED: &str = "https://github.com/Flavbestlol/aion2-pet-farm-guide/releases/latest/download/latest.json";
const PLUGIN_ID: &str = "farm-guide";
const MAX_FEED: u64 = 256 * 1024;
const MAX_EXE: u64 = 64 * 1024 * 1024;

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .user_agent(concat!("FarmGuideOverlay/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// A download, at most `max` bytes; `what` names it in the progress events the page shows.
fn fetch(app: Option<&AppHandle>, what: &str, url: &str, max: u64) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("only https downloads".into());
    }
    let res = agent().get(url).call().map_err(|e| format!("couldn't reach GitHub ({e})"))?;
    let total: u64 = res.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if total > max {
        return Err("the download is larger than expected".into());
    }
    let mut reader = res.into_reader().take(max + 1);
    let mut out = Vec::with_capacity(total as usize);
    let mut buf = vec![0u8; 64 * 1024];
    let mut last = 0usize;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("the download stopped ({e})"))?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        if let Some(app) = app {
            if out.len() - last >= 256 * 1024 {
                last = out.len();
                let _ = app.emit("update-progress", json!({ "what": what, "got": out.len(), "total": total }));
            }
        }
    }
    if out.len() as u64 > max {
        return Err("the download is larger than expected".into());
    }
    if let Some(app) = app {
        let _ = app.emit("update-progress", json!({ "what": what, "got": out.len(), "total": out.len() }));
    }
    Ok(out)
}



/// The feed, only if the publisher signed exactly these bytes.
fn verified_feed() -> Result<Value, String> {
    let body = fetch(None, "feed", FEED, MAX_FEED)?;
    let sig = fetch(None, "feed", &format!("{FEED}.sig"), 1024)?;
    signed(&body, &String::from_utf8_lossy(&sig))?;
    serde_json::from_slice(&body).map_err(|e| format!("the release notes are unreadable ({e})"))
}

/// Where A2 Tools loads Farm Guide from a folder (developer mode), and that copy's version.
fn plugin_folder() -> Option<(PathBuf, String)> {
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

/// What's out there: the signed feed, this overlay's version, and the plugin folder we may update.
#[tauri::command]
pub async fn update_check() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let feed = verified_feed()?;
        let plugin = plugin_folder().map(|(dir, v)| json!({ "dir": dir.display().to_string(), "version": v }));
        Ok(json!({ "feed": feed, "overlay": env!("CARGO_PKG_VERSION"), "plugin": plugin }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The new overlay, downloaded and checked, waiting next to this one as `<name>.new.exe`.
#[tauri::command]
pub async fn update_overlay(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let feed = verified_feed()?;
        let o = feed.get("overlay").ok_or("this release has no overlay")?;
        let url = o.get("url").and_then(Value::as_str).ok_or("no download link")?;
        let want = o.get("sha256").and_then(Value::as_str).ok_or("no checksum")?.to_lowercase();
        let bytes = fetch(Some(&app), "overlay", url, MAX_EXE)?;
        if sha256_hex(&bytes) != want || !bytes.starts_with(b"MZ") {
            return Err("the download doesn't match the release: not installing it".into());
        }
        let (_, new) = exe_paths()?;
        std::fs::write(&new, &bytes).map_err(|e| format!("couldn't save the update next to the overlay ({e})"))?;
        Ok(o.get("version").and_then(Value::as_str).unwrap_or("").to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn exe_paths() -> Result<(PathBuf, PathBuf), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let stem = exe.file_stem().and_then(|s| s.to_str()).unwrap_or("Farm Guide Overlay").to_string();
    let new = exe.with_file_name(format!("{stem}.new.exe"));
    Ok((exe, new))
}

/// Swap the waiting update in and start it: a small script waits for us to exit, moves the new exe
/// over the old one (retrying while Windows still holds it) and starts it; then it deletes itself.
#[tauri::command]
pub fn update_restart(app: AppHandle) -> Result<(), String> {
    let (exe, new) = exe_paths()?;
    if !new.is_file() {
        return Err("no update is waiting".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let pid = std::process::id();
        let script = std::env::temp_dir().join("farm-guide-overlay-update.cmd");
        let body = format!(
            "@echo off\r\nset \"EXE={exe}\"\r\nset \"NEW={new}\"\r\n:wait\r\ntasklist /FI \"PID eq {pid}\" 2>nul | find \"{pid}\" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)\r\nset /a n=0\r\n:move\r\nmove /Y \"%NEW%\" \"%EXE%\" >nul 2>&1\r\nif not errorlevel 1 goto started\r\nset /a n+=1\r\nif %n% geq 20 goto started\r\nping -n 2 127.0.0.1 >nul\r\ngoto move\r\n:started\r\nstart \"\" \"%EXE%\"\r\n(goto) 2>nul & del \"%~f0\"\r\n",
            exe = exe.display(),
            new = new.display(),
        );
        std::fs::write(&script, body).map_err(|e| e.to_string())?;
        std::process::Command::new("cmd")
            .arg("/C")
            .arg(&script)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("couldn't start the update ({e})"))?;
    }
    app.exit(0);
    Ok(())
}

/// The plugin, rewritten in the folder A2 Tools loads it from. Every file is checked first: the zip
/// must match the signed checksum, hold Farm Guide's manifest, and only files a plugin may have.
#[tauri::command]
pub async fn update_plugin(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (dir, _) = plugin_folder().ok_or("Farm Guide isn't loaded from a folder: A2 Tools updates it")?;
        let feed = verified_feed()?;
        let p = feed.get("plugin").ok_or("this release has no plugin")?;
        let url = p.get("url").and_then(Value::as_str).ok_or("no download link")?;
        let want = p.get("sha256").and_then(Value::as_str).ok_or("no checksum")?.to_lowercase();
        let bytes = fetch(Some(&app), "plugin", url, MAX_ZIP)?;
        if sha256_hex(&bytes) != want {
            return Err("the download doesn't match the release: not installing it".into());
        }
        let files = unzip_plugin(&bytes)?;
        let manifest: Value = files
            .iter()
            .find(|(p, _)| p == Path::new("manifest.json"))
            .and_then(|(_, b)| serde_json::from_slice(b).ok())
            .ok_or("the update has no manifest")?;
        if manifest.get("id").and_then(Value::as_str) != Some(PLUGIN_ID) {
            return Err("the update isn't Farm Guide".into());
        }
        for (rel, data) in &files {
            let path = dir.join(rel);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let tmp = path.with_extension("fgtmp");
            std::fs::write(&tmp, data).map_err(|e| format!("couldn't write {} ({e})", rel.display()))?;
            std::fs::rename(&tmp, &path).map_err(|e| format!("couldn't replace {} ({e})", rel.display()))?;
        }
        Ok(manifest.get("version").and_then(Value::as_str).unwrap_or("").to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

