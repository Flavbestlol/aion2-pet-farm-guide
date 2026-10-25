//! The installer's side that has nothing to do with A2 Tools: our own folder, the "Start with
//! Windows" answer, the version Settings › Apps shows, and what Flav-Toolkit's hub needs to list us
//! (addon.json and emblem.png beside the exe, and a link in Flav-Toolkit's folder; ADDONS.md
//! section 3). The overlay keeps those current itself at every start, since its own updater
//! replaces only the exe and the plugin, never runs the installer.

use std::path::{Path, PathBuf};

use crate::install_core;

/// The repository's addon.json (its version is replaced by the plugin's) and the emblem.
const ADDON_TEMPLATE: &str = include_str!("../../../addon.json");
const EMBLEM: &[u8] = include_bytes!("../../../emblem.png");

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
        // Flav-Toolkit's hub: addon.json and the emblem beside the exe, and the link to this folder
        "--setup-link" => Some(if link(Path::new(arg(1))).is_ok() { 0 } else { 1 }),
        "--setup-unlink" => {
            unlink(Path::new(arg(1)));
            Some(0)
        }
        _ => None,
    }
}

/// Where Flav-Toolkit's hub looks for add-ons that installed themselves.
fn link_file() -> Option<PathBuf> {
    let dir = std::env::var_os("FLAV_DATA_DIR").map(PathBuf::from).or_else(|| std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("com.flavbest.flav-toolkit")))?;
    Some(dir.join("addon-links").join("pet-farm-guide.json"))
}

/// Write a file only when it changed (written beside it and moved over it, so the hub never reads half).
fn put(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if std::fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("fgtmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// addon.json and emblem.png in `dir` (the install folder: the exe and farm-guide\ are there), and
/// the link to it in Flav-Toolkit's folder.
pub fn link(dir: &Path) -> Result<(), String> {
    let manifest = std::fs::read_to_string(dir.join("farm-guide").join("manifest.json")).map_err(|e| e.to_string())?;
    let version = install_core::plugin_version(&manifest).ok_or("no Farm Guide plugin in that folder")?;
    put(&dir.join("addon.json"), install_core::addon_json(ADDON_TEMPLATE, &version)?.as_bytes()).map_err(|e| e.to_string())?;
    put(&dir.join("emblem.png"), EMBLEM).map_err(|e| e.to_string())?;
    let file = link_file().ok_or("no APPDATA")?;
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    if !install_core::link_is(&text, &dir.display().to_string()) {
        put(&file, install_core::link_json(&dir.display().to_string()).as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Take the link away, when it names this folder (another copy's link stays).
pub fn unlink(dir: &Path) {
    if let Some(file) = link_file() {
        if install_core::link_is(&std::fs::read_to_string(&file).unwrap_or_default(), &dir.display().to_string()) {
            let _ = std::fs::remove_file(file);
        }
    }
}

/// Flav-Toolkit's Get add-ons installed this copy (its record, `.flav-install.json`, lies beside the
/// exe): Flav-Toolkit updates it, repairs it and starts it, so the overlay's own updater and "Start
/// with Windows" stand down.
pub fn store_installed() -> bool {
    std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(".flav-install.json").is_file())).unwrap_or(false)
}

/// How this copy came: "store" (Flav-Toolkit's Get add-ons, the way from 1.25.0), "setup" (the
/// project's old installer) or "hand" (a folder put in place by hand).
#[tauri::command]
pub fn install_kind() -> &'static str {
    if store_installed() {
        "store"
    } else if installed_here().is_some() {
        "setup"
    } else {
        "hand"
    }
}

/// At every start of an installed copy: addon.json, the emblem and the link as this version has them.
/// Never in a copy Flav-Toolkit installed: its files are the package's (Repair checks them).
pub fn sync_addon() {
    if store_installed() {
        return;
    }
    if let Some(here) = installed_here() {
        let _ = link(&here);
    }
}

/// HKCU key of the entry in Settings › Apps (written by the installer).
#[cfg(windows)]
const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AION2PetFarmGuide";

/// Keep Settings › Apps showing the installed release after the overlay updated it (installed copies
/// only). A release is named for its plugin's version, and updates rewrite the plugin in place.
/// The install folder, when this exe runs from it (Settings › Apps' entry names it).
#[cfg(windows)]
fn installed_here() -> Option<PathBuf> {
    let home = registry_get("InstallLocation")?;
    let here = std::env::current_exe().ok()?.parent()?.to_path_buf();
    same_path(&home, &here.display().to_string()).then_some(here)
}
#[cfg(not(windows))]
fn installed_here() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn registry_get(name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let w = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (k, n) = (w(UNINSTALL_KEY), w(name));
    let mut buf = [0u16; 1024];
    let mut size = (buf.len() * 2) as u32;
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    (r == 0).then(|| String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]))
}

#[cfg(windows)]
pub fn sync_installed_version() {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let Some(here) = installed_here() else { return };
    let Some(version) = std::fs::read_to_string(here.join("farm-guide").join("manifest.json")).ok().and_then(|t| install_core::plugin_version(&t)) else {
        return;
    };
    if registry_get("DisplayVersion").as_deref() == Some(version.as_str()) {
        return;
    }
    let w = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (k, n, v) = (w(UNINSTALL_KEY), w("DisplayVersion"), w(&version));
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), REG_SZ, v.as_ptr().cast(), (v.len() * 2) as u32) };
}
#[cfg(not(windows))]
pub fn sync_installed_version() {}
