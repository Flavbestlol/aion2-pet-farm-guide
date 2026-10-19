// Farm Guide Overlay: one transparent window over the whole screen, always on top, that never takes
// the game's focus. The mouse goes through it to the game everywhere except over the tip and the
// guide (the page tells us where those are), so it behaves like part of the game's HUD.
//
// Data: the Farm Guide plugin in A2 Tools writes its records as files under
// %APPDATA%\com.a2tools.dps-meter\plugin-data\farm-guide. We watch bridge.json there and pass each
// change to the page; we write only overlay.json there (our heartbeat). Our own settings live in
// %APPDATA%\app.farmguide.overlay.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod setup;
mod setup_core;
mod update;
mod update_core;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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

/// Our own files, and in the plugin's folder only our heartbeat (its records are never touched).
#[tauri::command]
fn write_file(state: tauri::State<State>, scope: String, key: String, value: String) -> Result<(), String> {
    if !valid_key(&key) || value.len() > 1024 * 1024 {
        return Err("bad key or value".into());
    }
    if scope == "plugin" && key != "overlay" {
        return Err("only overlay.json may be written in the plugin's folder".into());
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

/// Start with Windows (read or set).
#[tauri::command]
fn autostart(on: Option<bool>) -> bool {
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
        std::process::Command::new("explorer").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
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
    let mut tick: u32 = 0;
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
        // stay above the game (a borderless game window can take the top spot when it's focused)
        tick = tick.wrapping_add(1);
        if tick % 80 == 0 && state.showing.load(Ordering::SeqCst) {
            #[cfg(windows)]
            if let Ok(h) = window.hwnd() {
                win::raise_topmost(h.0 as isize);
            }
        }
    }
}

/// Watch for AION 2: running at all (every 2 s), and in front (every 300 ms); tell the page on change.
#[cfg(windows)]
fn watch_game(app: AppHandle) {
    let mut tick: u32 = 0;
    let mut last: Option<(bool, bool)> = None;
    let mut running = false;
    loop {
        if tick % 7 == 0 {
            running = win::game_running();
        }
        tick = tick.wrapping_add(1);
        let own = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0);
        let front = running && win::game_in_front(own);
        let state = app.state::<State>();
        state.game_running.store(running, Ordering::SeqCst);
        state.game_front.store(front, Ordering::SeqCst);
        if last != Some((running, front)) {
            last = Some((running, front));
            let _ = app.emit("game", (running, front));
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// Pass each new version of the plugin's bridge.json to the page.
fn watch_bridge(app: AppHandle) {
    let path = app.state::<State>().plugin_dir.join("bridge.json");
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

#[cfg(windows)]
mod win {
    //! Ctrl+Alt+L: seen with a low-level keyboard hook, which only looks and never takes the keys,
    //! so A2 Tools (which uses the same keys for its own lock) still gets them: one press locks both.
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetCursorInfo, GetForegroundWindow, GetMessageW, SetForegroundWindow, SetWindowPos,
        SetWindowsHookExW, CURSORINFO, CURSOR_SHOWING, HWND_TOPMOST, KBDLLHOOKSTRUCT, MSG, SWP_ASYNCWINDOWPOS,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
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

    static APP: OnceLock<AppHandle> = OnceLock::new();

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
    static mut L_DOWN: bool = false;

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let k = &*(lparam as *const KBDLLHOOKSTRUCT);
            let msg = wparam as u32;
            if k.vkCode == 0x4C {
                if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                    let ctrl = (GetAsyncKeyState(VK_CONTROL as i32) as u16 & 0x8000) != 0;
                    let alt = (GetAsyncKeyState(VK_MENU as i32) as u16 & 0x8000) != 0;
                    if ctrl && alt && !L_DOWN {
                        if let Some(app) = APP.get() {
                            // A2 Tools toggles its own lock on these keys: read its new state, so both agree
                            let app = app.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(450));
                                let _ = app.emit("hotkey-lock", crate::a2_locked());
                            });
                        }
                    }
                    L_DOWN = true;
                } else if msg == WM_KEYUP || msg == WM_SYSKEYUP {
                    L_DOWN = false;
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    pub fn start_hotkey(app: AppHandle) {
        let _ = APP.set(app);
        std::thread::spawn(|| unsafe {
            let h = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), GetModuleHandleW(std::ptr::null()), 0);
            if h.is_null() {
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {}
        });
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
pub fn a2_locked() -> Option<bool> {
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from)?;
    let text = std::fs::read_to_string(appdata.join("com.a2tools.dps-meter").join("settings.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    match v.get("dpsMeter.overlayLocked")? {
        serde_json::Value::Bool(b) => Some(*b),
        serde_json::Value::String(s) => Some(s == "true"),
        _ => None,
    }
}

fn main() {
    // the installer's commands (see setup.rs) run and exit before anything else
    if let Some(code) = setup::cli() {
        std::process::exit(code);
    }
    #[cfg(windows)]
    if win::already_running() {
        return;
    }
    setup::sync_installed_version();
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    let plugin_dir = std::env::var_os("FG_PLUGIN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| appdata.join("com.a2tools.dps-meter").join("plugin-data").join("farm-guide"));
    let own_dir = appdata.join("app.farmguide.overlay");
    let _ = std::fs::create_dir_all(&own_dir);
    let _ = std::fs::create_dir_all(&plugin_dir);

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
        .invoke_handler(tauri::generate_handler![read_file, write_file, set_hits, set_capture, set_focus, autostart, game_state, set_showing, quit, open_link, update::update_check, update::update_overlay, update::update_restart, update::update_plugin, setup::plugin_setup, setup::start_meter])
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

            // tray: the way back to the guide, and out
            let open = MenuItem::with_id(app, "open", "Open the guide", true, None::<&str>)?;
            let lock = MenuItem::with_id(app, "lock", "Lock / unlock (Ctrl+Alt+L)", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset", "Put the tip back in place", true, None::<&str>)?;
            let screen = MenuItem::with_id(app, "screen", "Move to the next screen", true, None::<&str>)?;
            let upd = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Close the overlay", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &lock, &reset, &screen, &upd, &sep, &quit_i])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("Farm Guide Overlay");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, e| {
                let id = e.id.as_ref();
                if id == "screen" {
                    if let Some(w) = app.get_webview_window("main") {
                        let n = w.available_monitors().map(|m| m.len()).unwrap_or(1).max(1);
                        let s = app.state::<State>();
                        s.monitor.store((s.monitor.load(Ordering::SeqCst) + 1) % n, Ordering::SeqCst);
                        place(app, &w);
                        // a screen with another scale resizes us after the move: place again once it settles
                        let (app2, w2) = (app.clone(), w.clone());
                        std::thread::spawn(move || {
                            for ms in [250, 700] {
                                std::thread::sleep(Duration::from_millis(ms));
                                place(&app2, &w2);
                            }
                        });
                    }
                } else {
                    let _ = app.emit("tray", id.to_string());
                    if id == "quit" {
                        // the page writes "gone" to the heartbeat, then quits; this is the fallback
                        let app = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(1500));
                            app.exit(0);
                        });
                    }
                }
            })
            .build(app)?;

            let h = app.handle().clone();
            std::thread::spawn(move || hit_test_loop(h));
            let h = app.handle().clone();
            std::thread::spawn(move || watch_bridge(h));
            #[cfg(windows)]
            win::start_hotkey(app.handle().clone());
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
