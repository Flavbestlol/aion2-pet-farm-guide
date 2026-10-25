//! The installer's side that has nothing to do with where the game records come from: our own
//! folder, the "Start with Windows" answer, and the version Settings › Apps shows.

use std::path::PathBuf;

/// The overlay's own folder (%APPDATA%\app.farmguide.overlay): its settings, route and records.
pub fn own_dir() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".")).join("app.farmguide.overlay")
}

/// The same folder as Windows sees it: case, slash direction and a trailing separator don't matter.
#[cfg(windows)]
fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.trim().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    norm(a) == norm(b)
}

/// The installer's commands that aren't about A2 Tools. `None`: not one of them.
pub fn cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");
    match arg(0) {
        // the installer's "Start with Windows" box; the page takes it as your answer (installer.json)
        "--setup-autostart" => {
            let on = arg(1) == "on";
            #[cfg(windows)]
            crate::win::autostart_set(on);
            let _ = std::fs::create_dir_all(own_dir());
            let _ = std::fs::write(own_dir().join("installer.json"), serde_json::json!({ "autostart": on }).to_string());
            Some(0)
        }
        _ => None,
    }
}

/// HKCU key of the entry in Settings › Apps (written by the installer).
#[cfg(windows)]
const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AION2PetFarmGuide";

/// Keep Settings › Apps showing the installed release after the overlay updated it (installed copies
/// only). A release is named for its plugin's version, and updates rewrite the plugin in place.
#[cfg(windows)]
pub fn sync_installed_version() {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ};
    let w = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let get = |name: &str| -> Option<String> {
        let (k, n) = (w(UNINSTALL_KEY), w(name));
        let mut buf = [0u16; 1024];
        let mut size = (buf.len() * 2) as u32;
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
        (r == 0).then(|| String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]))
    };
    let Some(home) = get("InstallLocation") else { return };
    let Some(here) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) else { return };
    if !same_path(&home, &here.display().to_string()) {
        return;
    }
    let Some(version) = std::fs::read_to_string(here.join("farm-guide").join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|m| m.get("version").and_then(|v| v.as_str()).map(String::from))
    else {
        return;
    };
    if get("DisplayVersion").as_deref() == Some(version.as_str()) {
        return;
    }
    let (k, n, v) = (w(UNINSTALL_KEY), w("DisplayVersion"), w(&version));
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), REG_SZ, v.as_ptr().cast(), (v.len() * 2) as u32) };
}
#[cfg(not(windows))]
pub fn sync_installed_version() {}
