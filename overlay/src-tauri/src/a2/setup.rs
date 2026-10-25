//! Setting up with A2 Tools, for the installer and for the first start after it. (A2 Tools only:
//! goes with the rest of `a2/` when A2 Tools support is dropped.)
//!
//! The installer runs `Farm Guide Overlay.exe --setup-register "<plugin folder>"`, which adds the
//! folder to A2 Tools' plugin folders (developer mode), as Settings › Plugins › Load plugin folder…
//! does. A2 Tools holds its settings in memory and writes them all back on every change, so its file
//! is edited only while it's closed. While it's open (or not installed yet) the folder is remembered,
//! and the overlay finishes the job later: the page asks `plugin_setup` and says what to do.
//!
//! Exit codes for the installer: 0 done, 1 failed, 2 A2 Tools is open, 3 A2 Tools isn't installed.
//! A folder you take off the list in A2 Tools stays off: the overlay only finishes what the installer
//! asked for.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::setup_core;
use crate::install::own_dir;

pub enum Outcome {
    Added,
    Already,
    MeterOpen,
    NoMeter,
    Failed(String),
}

impl Outcome {
    fn code(&self) -> i32 {
        match self {
            Outcome::Added | Outcome::Already => 0,
            Outcome::Failed(_) => 1,
            Outcome::MeterOpen => 2,
            Outcome::NoMeter => 3,
        }
    }
}

fn appdata() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}
fn settings_path() -> PathBuf {
    appdata().join("com.a2tools.dps-meter").join("settings.json")
}

fn is_farm_guide(dir: &str) -> bool {
    std::fs::read_to_string(Path::new(dir).join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')).ok())
        .is_some_and(|m| m.get("id").and_then(|v| v.as_str()) == Some("farm-guide"))
}

/// A copy of A2 Tools' settings as they were before our first change, then the change: written
/// beside the file and moved over it, so A2 Tools never reads half a file.
fn save_settings(path: &Path, new: &str) -> Result<(), String> {
    let backup = path.with_file_name("settings.json.farm-guide-backup");
    if !backup.exists() {
        let _ = std::fs::copy(path, &backup);
    }
    let tmp = path.with_file_name("settings.json.farm-guide-tmp");
    let moved = std::fs::write(&tmp, new).and_then(|_| std::fs::rename(&tmp, path));
    if moved.is_err() {
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(path, new).map_err(|e| format!("couldn't write A2 Tools' settings ({e})"))?;
    }
    Ok(())
}

fn edit(change: impl Fn(&str) -> Result<Option<String>, String>) -> Outcome {
    let path = settings_path();
    if !path.is_file() {
        return Outcome::NoMeter;
    }
    if meter_running() {
        return Outcome::MeterOpen;
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return Outcome::Failed(format!("couldn't read A2 Tools' settings ({e})")),
    };
    match change(&text) {
        Ok(None) => Outcome::Already,
        Ok(Some(new)) => match save_settings(&path, &new) {
            Ok(()) => Outcome::Added,
            Err(e) => Outcome::Failed(e),
        },
        Err(e) => Outcome::Failed(e),
    }
}

pub fn register(dir: &str) -> Outcome {
    if !is_farm_guide(dir) {
        return Outcome::Failed(format!("{dir} doesn't hold Farm Guide"));
    }
    edit(|text| setup_core::with_folder(text, dir, |f| !setup_core::same_path(f, dir) && is_farm_guide(f)))
}

pub fn unregister(dir: &str) -> Outcome {
    edit(|text| setup_core::without_folder(text, dir))
}

// ── what's left to do, kept in our own folder (setup.json) ──
fn pending_file() -> PathBuf {
    own_dir().join("setup.json")
}
fn pending() -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(pending_file()).ok()?).ok()?;
    v.get("register").and_then(|d| d.as_str()).map(String::from)
}
fn remember(dir: &str) {
    let _ = std::fs::create_dir_all(own_dir());
    let _ = std::fs::write(pending_file(), serde_json::json!({ "register": dir }).to_string());
}
fn forget() {
    let _ = std::fs::remove_file(pending_file());
}

/// The installer's commands. `None`: not one of them, start the overlay as usual.
pub fn cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");
    match arg(0) {
        "--setup-register" => {
            let dir = arg(1);
            let o = register(dir);
            match o {
                Outcome::MeterOpen | Outcome::NoMeter => remember(dir),
                _ => forget(),
            }
            Some(o.code())
        }
        "--setup-unregister" => {
            forget();
            Some(unregister(arg(1)).code())
        }
        _ => None,
    }
}

/// Finish what the installer started. "none": nothing to do; "waiting": A2 Tools is open (close it
/// and we carry on); "nometer": A2 Tools isn't installed yet; "added" / "added:start": done (and we
/// know where A2 Tools is, so the page can offer to start it); "failed:<why>".
#[tauri::command]
pub fn plugin_setup() -> String {
    let Some(dir) = pending() else { return "none".into() };
    match register(&dir) {
        Outcome::Added | Outcome::Already => {
            forget();
            if meter_exe().is_some() { "added:start".into() } else { "added".into() }
        }
        Outcome::MeterOpen => "waiting".into(),
        Outcome::NoMeter => "nometer".into(),
        Outcome::Failed(e) => {
            forget();
            format!("failed:{e}")
        }
    }
}

/// Start A2 Tools again (it asks for administrator rights, as it runs with them).
#[tauri::command]
pub fn start_meter() -> Result<(), String> {
    let exe = meter_exe().ok_or("A2 Tools wasn't found")?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let w = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let (verb, file) = (w("runas"), w(&exe.display().to_string()));
        let dir = w(&exe.parent().map(|p| p.display().to_string()).unwrap_or_default());
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), dir.as_ptr(), 1) };
        if (r as isize) <= 32 {
            return Err("A2 Tools didn't start".into());
        }
    }
    Ok(())
}

/// Where A2 Tools runs from, as seen while it was open.
static METER_EXE: Mutex<Option<PathBuf>> = Mutex::new(None);
fn meter_exe() -> Option<PathBuf> {
    METER_EXE.lock().unwrap_or_else(|p| p.into_inner()).clone().filter(|p| p.is_file())
}

/// A2 Tools' own process ("A2Tools DPS Meter.exe"), not its helpers.
fn is_meter(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with("a2tools") && n.ends_with(".exe") && !n.contains("hotkeys")
}

#[cfg(windows)]
pub fn meter_running() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut more = Process32FirstW(snap, &mut e) != 0;
        while more {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            if is_meter(&String::from_utf16_lossy(&e.szExeFile[..len])) {
                found = Some(e.th32ProcessID);
                break;
            }
            more = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        let Some(pid) = found else { return false };
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !p.is_null() {
            let mut buf = [0u16; 1024];
            let mut n = buf.len() as u32;
            if QueryFullProcessImageNameW(p, 0, buf.as_mut_ptr(), &mut n) != 0 {
                *METER_EXE.lock().unwrap_or_else(|x| x.into_inner()) = Some(PathBuf::from(String::from_utf16_lossy(&buf[..n as usize])));
            }
            CloseHandle(p);
        }
        true
    }
}
#[cfg(not(windows))]
pub fn meter_running() -> bool {
    // for tests on other systems: FG_METER_OPEN=1 plays an open A2 Tools
    std::env::var_os("FG_METER_OPEN").is_some()
}
