//! Finishing an update an older copy started. Up to 1.24.0 the overlay updated itself from the
//! project's GitHub Releases: it saved the new exe as `<name>.new.exe` and started it with
//! `--finish-update <its pid> <its path>`; the new copy waits for the old one to exit, copies itself
//! over it and starts it. From 1.25.0 Flav-Toolkit installs and updates the guide (Get add-ons) and
//! the overlay has no updater of its own, but a copy updating from an older version arrives here,
//! so this hand-over stays. It reaches no network.
use std::path::PathBuf;
use std::time::Duration;

fn exe_paths() -> Result<(PathBuf, PathBuf), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let stem = exe.file_stem().and_then(|s| s.to_str()).unwrap_or("Farm Guide Overlay").to_string();
    let new = exe.with_file_name(format!("{stem}.new.exe"));
    Ok((exe, new))
}

/// Run by the new copy, started by an older overlay's updater. `None`: not asked to; start as usual.
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

