// Farm Guide Overlay: one transparent window over the whole screen, always on top, that never takes
// the game's focus. The mouse goes through it to the game everywhere except over the tip and the
// guide (the page tells us where those are), so it behaves like part of the game's HUD.
//
// Data: game records come from a source: Flav-Toolkit's feed (feed.rs) while it runs, else the Farm
// Guide plugin in A2 Tools (a2/: everything about A2 Tools is there). Our own settings live in %APPDATA%\app.farmguide.overlay.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod a2;
mod feed;
mod feed_core;
mod handover;
mod install;
mod install_core;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

struct State {
    rects: Mutex<Vec<[f64; 4]>>,
    /// locked: the parts take the mouse only while Alt is held
    alt_only: AtomicBool,
    capture: AtomicBool,
    plugin_dir: PathBuf,
    own_dir: PathBuf,
    monitor: AtomicUsize,
    game_running: AtomicBool,
    game_front: AtomicBool,
    /// the page shows something (the game is up, and in front unless "always show" is on)
    showing: AtomicBool,
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 64 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn dir_of(state: &State, scope: &str) -> Result<PathBuf, String> {
    match scope {
        "plugin" => Ok(state.plugin_dir.clone()),
        "own" => Ok(state.own_dir.clone()),
        _ => Err("unknown scope".into()),
    }
}

#[tauri::command]
fn read_file(state: tauri::State<State>, scope: String, key: String) -> Option<String> {
    if !valid_key(&key) {
        return None;
    }
    std::fs::read_to_string(dir_of(&state, &scope).ok()?.join(format!("{key}.json"))).ok()
}

/// A file and when it was last written (Unix ms), to tell which of two copies is newer.
#[tauri::command]
fn read_stamped(state: tauri::State<State>, scope: String, key: String) -> Option<(String, u64)> {
    if !valid_key(&key) {
        return None;
    }
    let path = dir_of(&state, &scope).ok()?.join(format!("{key}.json"));
    let at = std::fs::metadata(&path).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    Some((std::fs::read_to_string(&path).ok()?, at))
}

/// Our own files, and in the plugin's folder only our heartbeat (its records are never touched).
#[tauri::command]
fn write_file(state: tauri::State<State>, scope: String, key: String, value: String) -> Result<(), String> {
    if !valid_key(&key) || value.len() > 1024 * 1024 {
        return Err("bad key or value".into());
    }
    if scope == "plugin" && key != "overlay" {
        return Err("only overlay.json may be written in the plugin's folder".into());
    }
    if scope == "plugin" && !a2::installed() {
        return Err("A2 Tools isn't on this PC".into());
    }
    let dir = dir_of(&state, &scope)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // write then rename, so a reader never sees half a file
    let tmp = dir.join(format!(".{key}.tmp"));
    std::fs::write(&tmp, value).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(format!("{key}.json"))).map_err(|e| e.to_string())
}

/// The parts of the page that take the mouse, in CSS pixels.
#[tauri::command]
fn set_hits(state: tauri::State<State>, rects: Vec<[f64; 4]>, alt_only: Option<bool>) {
    *state.rects.lock().unwrap_or_else(|p| p.into_inner()) = rects;
    state.alt_only.store(alt_only.unwrap_or(false), Ordering::SeqCst);
}

/// While dragging, the whole window takes the mouse.
#[tauri::command]
fn set_capture(state: tauri::State<State>, on: bool) {
    state.capture.store(on, Ordering::SeqCst);
}

/// Typing needs keyboard focus: taken only while a text field is in use, then given back.
#[tauri::command]
fn set_focus(window: WebviewWindow, on: bool) {
    if on {
        #[cfg(windows)]
        win::remember_foreground();
        let _ = window.set_focusable(true);
        let _ = window.set_focus();
    } else {
        let _ = window.set_focusable(false);
        // hand the keyboard back to the game
        #[cfg(windows)]
        win::restore_foreground();
    }
}

/// Whether the page is showing anything (nothing to keep on top otherwise).
#[tauri::command]
fn set_showing(state: tauri::State<State>, on: bool) {
    state.showing.store(on, Ordering::SeqCst);
}

/// Start with Windows (read or set). Never for a copy Flav-Toolkit installed: Flav-Toolkit starts it
/// (and the entry an older copy left goes, so two overlays never race at sign-in).
#[tauri::command]
fn autostart(on: Option<bool>) -> bool {
    let on = if install::store_installed() { Some(false) } else { on };
    #[cfg(windows)]
    {
        if let Some(on) = on {
            win::autostart_set(on);
        }
        win::autostart_get()
    }
    #[cfg(not(windows))]
    {
        on.unwrap_or(false)
    }
}

/// The game's state, now (the page also hears "game" whenever it changes).
#[tauri::command]
fn game_state(state: tauri::State<State>) -> (bool, bool) {
    (state.game_running.load(Ordering::SeqCst), state.game_front.load(Ordering::SeqCst))
}

/// A link from the page, in the default browser. Only https, and only the sites the guide links to.
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    const SITES: [&str; 6] = ["ko-fi.com", "github.com", "a2tools.app", "metabot.gg", "npcap.com", "wikily.gg"];
    let rest = url.strip_prefix("https://").ok_or("only https links")?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if url.len() > 300 || url.chars().any(|c| c.is_control() || c == '"' || c == ' ') || !SITES.contains(&host) {
        return Err("not a link the guide opens".into());
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let w = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let (verb, target) = (w("open"), w(&url));
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if (r as isize) <= 32 {
            return Err("the browser didn't open".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Settings › Overlay › Next screen: the overlay moves to the next monitor (round the list).
#[tauri::command]
fn next_screen(app: AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    let n = w.available_monitors().map(|m| m.len()).unwrap_or(1).max(1);
    let s = app.state::<State>();
    s.monitor.store((s.monitor.load(Ordering::SeqCst) + 1) % n, Ordering::SeqCst);
    place(&app, &w);
    // a screen with another scale resizes us after the move: place again once it settles
    std::thread::spawn(move || {
        for ms in [250, 700] {
            std::thread::sleep(Duration::from_millis(ms));
            place(&app, &w);
        }
    });
}

/// Cover a monitor (one pixel short of its height, so Windows doesn't treat us as a full-screen app).
fn place(app: &AppHandle, window: &WebviewWindow) {
    let monitors = window.available_monitors().unwrap_or_default();
    let state = app.state::<State>();
    let idx = state.monitor.load(Ordering::SeqCst);
    let m = monitors.get(idx).cloned().or_else(|| window.primary_monitor().ok().flatten());
    if let Some(m) = m {
        let p = m.position();
        let s = m.size();
        let _ = window.set_position(PhysicalPosition::new(p.x, p.y));
        let _ = window.set_size(PhysicalSize::new(s.width, s.height.saturating_sub(1)));
    }
}

/// Mouse through to the game, except over the page's own parts.
fn hit_test_loop(app: AppHandle) {
    let mut ignoring: Option<bool> = None;
    loop {
        std::thread::sleep(Duration::from_millis(25));
        let Some(window) = app.get_webview_window("main") else { continue };
        let state = app.state::<State>();
        #[cfg(windows)]
        let pointer_ok = win::cursor_showing() && (!state.alt_only.load(Ordering::SeqCst) || win::alt_down());
        #[cfg(not(windows))]
        let pointer_ok = !state.alt_only.load(Ordering::SeqCst);
        let inside = state.capture.load(Ordering::SeqCst) || pointer_ok && {
            match (window.cursor_position(), window.inner_position(), window.scale_factor()) {
                (Ok(c), Ok(o), Ok(s)) => {
                    let (x, y) = ((c.x - o.x as f64) / s, (c.y - o.y as f64) / s);
                    let rects = state.rects.lock().unwrap_or_else(|p| p.into_inner());
                    rects.iter().any(|r| x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3])
                }
                _ => false,
            }
        };
        let ignore = !inside;
        if ignoring != Some(ignore) && window.set_ignore_cursor_events(ignore).is_ok() {
            ignoring = Some(ignore);
        }
    }
}

/// Watch for AION 2: running at all (every 2 s), and in front (every 300 ms); tell the page on change.
#[cfg(windows)]
fn watch_game(app: AppHandle) {
    use tauri::Emitter;
    let mut tick: u32 = 0;
    let mut last: Option<(bool, bool)> = None;
    let mut running = false;
    loop {
        if tick.is_multiple_of(7) {
            running = win::game_running();
        }
        tick = tick.wrapping_add(1);
        let own = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0);
        let front = running && win::game_in_front(own);
        let state = app.state::<State>();
        state.game_running.store(running, Ordering::SeqCst);
        state.game_front.store(front, Ordering::SeqCst);
        if last != Some((running, front)) {
            // the game just came to the front: step above it once (a borderless game window can take
            // the top spot when it's focused). Never on a timer: Flav-Toolkit's dock and hub stay
            // above add-ons, and two windows re-raising themselves would fight (ADDONS.md section 8).
            if front && last.is_none_or(|(_, was)| !was) && state.showing.load(Ordering::SeqCst) {
                if let Some(h) = app.get_webview_window("main").and_then(|w| w.hwnd().ok()) {
                    win::raise_topmost(h.0 as isize);
                }
            }
            last = Some((running, front));
            let _ = app.emit("game", (running, front));
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

#[cfg(windows)]
mod win {
    //! Windows only: the game's window, focus, the cursor, start with Windows, one copy at a time.
    //! (No keyboard hook: Ctrl+Alt+L is A2 Tools' own key, and we follow its lock; see a2::watch_lock.)
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorInfo, GetForegroundWindow, SetForegroundWindow, SetWindowPos, CURSORINFO, CURSOR_SHOWING, HWND_TOPMOST,
        SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    use std::sync::atomic::{AtomicIsize, Ordering};

    static FOREGROUND: AtomicIsize = AtomicIsize::new(0);
    pub fn remember_foreground() {
        let h = unsafe { GetForegroundWindow() } as isize;
        if h != 0 {
            FOREGROUND.store(h, Ordering::SeqCst);
        }
    }
    pub fn restore_foreground() {
        let h = FOREGROUND.swap(0, Ordering::SeqCst);
        if h != 0 {
            unsafe { SetForegroundWindow(h as _) };
        }
    }
    /// Back to the top of the always-on-top windows, without taking focus.
    pub fn raise_topmost(hwnd: isize) {
        unsafe {
            SetWindowPos(hwnd as _, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
        }
    }
    /// The game hides the cursor while you steer the camera; then nothing of ours takes the mouse.
    pub fn cursor_showing() -> bool {
        unsafe {
            let mut ci: CURSORINFO = std::mem::zeroed();
            ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
            if GetCursorInfo(&mut ci) == 0 {
                return true;
            }
            ci.flags & CURSOR_SHOWING != 0
        }
    }
    pub fn alt_down() -> bool {
        unsafe { (GetAsyncKeyState(VK_MENU as i32) as u16 & 0x8000) != 0 }
    }

    // ── AION 2: running, and in front? (found as A2 Tools finds it: title "AION2…" or AION2.exe) ──
    use windows_sys::Win32::Foundation::{CloseHandle, HWND};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};

    fn title(h: HWND) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32) }.max(0) as usize;
        String::from_utf16_lossy(&buf[..n])
    }
    fn exe_name(h: HWND) -> Option<String> {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            if pid == 0 {
                return None;
            }
            let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if p.is_null() {
                return None;
            }
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(p, 0, buf.as_mut_ptr(), &mut len) != 0;
            CloseHandle(p);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]).rsplit(['\\', '/']).next().unwrap_or("").to_string())
        }
    }
    fn is_game(h: HWND) -> bool {
        if h.is_null() {
            return false;
        }
        title(h).starts_with("AION2") || exe_name(h).is_some_and(|n| n.eq_ignore_ascii_case("AION2.exe"))
    }
    pub fn game_running() -> bool {
        unsafe extern "system" fn each(h: HWND, lp: isize) -> i32 {
            let found = &mut *(lp as *mut bool);
            if IsWindowVisible(h) != 0 && is_game(h) {
                *found = true;
                return 0; // stop
            }
            1
        }
        let mut found = false;
        unsafe { EnumWindows(Some(each), &mut found as *mut bool as isize) };
        found
    }
    /// The game, or this overlay (while you type in it), is the window in front.
    pub fn game_in_front(own: isize) -> bool {
        let f = unsafe { GetForegroundWindow() };
        (f as isize) == own || is_game(f)
    }

    // ── start with Windows: HKCU\…\Run ──
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
    };
    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const NAME: &str = "FarmGuideOverlay";
    pub fn autostart_get() -> bool {
        let (k, n) = (w(RUN), w(NAME));
        let mut size = 0u32;
        unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) == 0 }
    }
    pub fn autostart_set(on: bool) -> bool {
        let (k, n) = (w(RUN), w(NAME));
        unsafe {
            if on {
                let Ok(exe) = std::env::current_exe() else { return false };
                let v = w(&format!("\"{}\" --autostart", exe.display()));
                RegSetKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), REG_SZ, v.as_ptr() as *const _, (v.len() * 2) as u32) == 0
            } else {
                let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr());
                r == 0 || r == 2 // gone already
            }
        }
    }
    /// One overlay at a time.
    pub fn already_running() -> bool {
        let name: Vec<u16> = "Local\\FarmGuideOverlay\0".encode_utf16().collect();
        unsafe {
            let h = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
            !h.is_null() && GetLastError() == ERROR_ALREADY_EXISTS
        }
    }
}

/// A2 Tools' own click-through lock, from its settings file (None if it can't be read).
fn main() {
    // the installer's commands (see setup.rs) run and exit before anything else
    if let Some(code) = handover::cli().or_else(install::cli).or_else(a2::setup::cli) {
        std::process::exit(code);
    }
    #[cfg(windows)]
    if win::already_running() {
        return;
    }
    install::sync_installed_version();
    install::sync_addon();
    handover::tidy_after_update();
    let plugin_dir = a2::plugin_dir();
    let own_dir = install::own_dir();
    let _ = std::fs::create_dir_all(&own_dir);

    tauri::Builder::default()
        .manage(State {
            rects: Mutex::new(Vec::new()),
            alt_only: AtomicBool::new(false),
            capture: AtomicBool::new(false),
            plugin_dir,
            own_dir,
            monitor: AtomicUsize::new(0),
            game_running: AtomicBool::new(cfg!(not(windows))),
            game_front: AtomicBool::new(cfg!(not(windows))),
            showing: AtomicBool::new(true),
        })
        .manage(feed::FeedState(Mutex::new(serde_json::json!({ "feed": false }))))
        .invoke_handler(tauri::generate_handler![read_file, read_stamped, feed::source_state, feed::feed_start, feed::core_installed, write_file, set_hits, set_capture, set_focus, autostart, game_state, set_showing, quit, next_screen, open_link, install::install_kind, a2::setup::plugin_setup, a2::setup::start_meter])
        .setup(|app| {
            // built already in place and visible, so it never activates (a show() later would take focus)
            let (mut lx, mut ly, mut lw, mut lh) = (0.0, 0.0, 1280.0, 720.0);
            if let Ok(Some(m)) = app.primary_monitor() {
                let sf = m.scale_factor();
                lx = m.position().x as f64 / sf;
                ly = m.position().y as f64 / sf;
                lw = m.size().width as f64 / sf;
                lh = (m.size().height.saturating_sub(1)) as f64 / sf;
            }
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .position(lx, ly)
                .inner_size(lw, lh)
                .title("Farm Guide Overlay")
                .transparent(true)
                .decorations(false)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focusable(false)
                .focused(false)
                .visible(true)
                .build()?;
            // start on the primary monitor
            if let (Ok(all), Ok(Some(primary))) = (window.available_monitors(), window.primary_monitor()) {
                if let Some(i) = all.iter().position(|m| m.position() == primary.position()) {
                    app.state::<State>().monitor.store(i, Ordering::SeqCst);
                }
            }
            place(app.handle(), &window);
            let _ = window.set_ignore_cursor_events(true);

            let h = app.handle().clone();
            std::thread::spawn(move || hit_test_loop(h));
            a2::start(app.handle());
            #[cfg(windows)]
            {
                let h = app.handle().clone();
                std::thread::spawn(move || watch_game(h));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Farm Guide Overlay failed to start");
}
