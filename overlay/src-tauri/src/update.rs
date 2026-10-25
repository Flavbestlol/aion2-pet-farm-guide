//! Updates, from the project's GitHub Releases.
//!
//! Each release carries `latest.json` (what's new, and where the overlay's exe and the plugin's zip
//! are, with their SHA-256) and `latest.json.sig`: an Ed25519 signature over those exact bytes. The
//! public key is built in below; the private key never leaves the publisher's computer. So a release
//! is installed only when it was signed by the publisher and every byte matches what they signed,
//! whoever serves the files.
//!
//! The overlay's exe is replaced next to itself: the new one is saved as `<name>.new.exe`, and it
//! copies itself over the old one once that has exited (see update_restart).
//! The plugin is updated where A2 Tools loads it from a folder (developer mode), or else beside the
//! exe (Flav-Toolkit runs its decoders from there): its files are rewritten in that folder.
//! A plugin installed from A2 Tools' own reviewed catalog is left to A2 Tools.
//!
//! Only GitHub is reached: github.com, then the hosts GitHub hands its release files out from.
//! A redirect anywhere else is refused (ADDONS.md section 8; addon.json lists the same hosts).
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

/// The hosts a download may come from (addon.json `permissions.network`).
const HOSTS: [&str; 3] = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        // redirects are followed by hand, each one checked against HOSTS
        .redirects(0)
        .user_agent(concat!("FarmGuideOverlay/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// A download, at most `max` bytes; `what` names it in the progress events the page shows.
fn fetch(app: Option<&AppHandle>, what: &str, url: &str, max: u64) -> Result<Vec<u8>, String> {
    let agent = agent();
    let mut url = url.to_string();
    let mut hops = 0;
    let res = loop {
        let host = url.strip_prefix("https://").and_then(|r| r.split(['/', '?', '#']).next()).unwrap_or("").to_ascii_lowercase();
        if !HOSTS.contains(&host.as_str()) {
            return Err("only https downloads from GitHub".into());
        }
        let res = agent.get(&url).call().map_err(|e| format!("couldn't reach GitHub ({e})"))?;
        if !(300..400).contains(&res.status()) {
            break res;
        }
        hops += 1;
        url = match res.header("Location") {
            Some(next) if hops <= 5 => next.to_string(),
            _ => return Err("GitHub sent the download somewhere unexpected".into()),
        };
    };
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

/// What's out there: the signed feed, this overlay's version, and the plugin folder we may update.
#[tauri::command]
pub async fn update_check() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let feed = verified_feed()?;
        let plugin = crate::a2::plugin_folder().or_else(crate::install::own_plugin_folder).map(|(dir, v)| json!({ "dir": dir.display().to_string(), "version": v }));
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

/// Swap the waiting update in and start it. The new copy does it itself: we start it with
/// `--finish-update <our pid> <our path>` and exit; it waits for us to be gone, copies itself over
/// us, starts that, and exits. The next start tidies the `.new.exe` away (`tidy_after_update`).
#[tauri::command]
pub fn update_restart(app: AppHandle) -> Result<(), String> {
    let (exe, new) = exe_paths()?;
    if !new.is_file() {
        return Err("no update is waiting".into());
    }
    std::process::Command::new(&new)
        .arg("--finish-update")
        .arg(std::process::id().to_string())
        .arg(&exe)
        .spawn()
        .map_err(|e| format!("couldn't start the update ({e})"))?;
    app.exit(0);
    Ok(())
}

/// Run by the new copy (see update_restart). `None`: not asked to; start as usual.
pub fn cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--finish-update") {
        return None;
    }
    let (Some(pid), Some(target)) = (args.get(1).and_then(|p| p.parse::<u32>().ok()), args.get(2)) else { return Some(1) };
    let target = PathBuf::from(target);
    let me = std::env::current_exe().ok()?;
    // only ever over the copy that started us, next to us
    if target.parent() != me.parent() || !target.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
        return Some(1);
    }
    wait_for_exit(pid);
    let mut copied = false;
    for _ in 0..40 {
        if std::fs::copy(&me, &target).is_ok() {
            copied = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    // copied or not, start the overlay again (the old one if the copy failed)
    let _ = std::process::Command::new(&target).spawn();
    Some(if copied { 0 } else { 1 })
}

#[cfg(windows)]
fn wait_for_exit(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    unsafe {
        let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !h.is_null() {
            WaitForSingleObject(h, 30_000);
            CloseHandle(h);
        }
    }
}
#[cfg(not(windows))]
fn wait_for_exit(_pid: u32) {}

/// After an update: the `.new.exe` that copied itself over us is no longer needed.
pub fn tidy_after_update() {
    let Ok((exe, new)) = exe_paths() else { return };
    if exe == new || !new.is_file() {
        return;
    }
    std::thread::spawn(move || {
        for _ in 0..20 {
            if std::fs::remove_file(&new).is_ok() || !new.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

/// The plugin, rewritten in the folder A2 Tools loads it from, or else the one beside the exe (whose
/// decoders Flav-Toolkit runs). Every file is checked first: the zip
/// must match the signed checksum, hold Farm Guide's manifest, and only files a plugin may have.
#[tauri::command]
pub async fn update_plugin(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (dir, _) = crate::a2::plugin_folder().or_else(crate::install::own_plugin_folder).ok_or("Farm Guide isn't loaded from a folder: A2 Tools updates it")?;
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

