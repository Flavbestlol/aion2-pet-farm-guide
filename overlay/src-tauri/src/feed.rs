//! Flav-Toolkit as the source of game records: its local feed, read here on the Rust side with
//! flav-sdk (the feed refuses web pages; ADDONS.md section 4). Flav-Toolkit runs Farm Guide's own
//! decoders (addon.json `decoders`) and serves what they read as `decoded` events, beside its own
//! `my_server` and `my_profile`.
//!
//! The page gets every event as it came (`feed`), the core's status (`feed-status`), the hub's
//! Open and Settings (`show`), and which source is in use (`source`). It decides the rest
//! (web/source-feed.js), so the same rules run in its tests.
//!
//! We connect once the page says it's ready (`feed_start`). The core is in use while we're
//! connected: `Client::connect` succeeds only once welcomed, and fails fast when Flav-Toolkit isn't
//! running (no feed.json, or nobody at its port). After a drop we try again every 2 s; the page
//! falls back to A2 Tools meanwhile.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use flav_sdk::{Client, Error};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::feed_core;

/// What the page asks for when it loads (it may load after the first `source` event).
pub struct FeedState(pub Mutex<Value>);

#[tauri::command]
pub fn source_state(state: tauri::State<FeedState>) -> Value {
    state.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

fn set(app: &AppHandle, v: Value) {
    *app.state::<FeedState>().0.lock().unwrap_or_else(|p| p.into_inner()) = v.clone();
    let _ = app.emit("source", v);
}

/// The page is ready for events (its guide has its handlers): connect now, so the state and the kept
/// pet list Flav-Toolkit sends at once on connecting reach it. Once; reconnects happen by themselves.
#[tauri::command]
pub fn feed_start(app: AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let addon_json = std::env::current_exe().ok().and_then(|e| std::fs::read_to_string(e.with_file_name("addon.json")).ok());
        let config = feed_core::config(addon_json.as_deref());
        // the last refusal told to the page, so a core that keeps refusing is told once
        let mut told: Option<String> = None;
        loop {
            match Client::connect(&config) {
                Ok(mut client) => {
                    told = None;
                    set(&app, json!({ "feed": true, "core": client.core, "status": client.status }));
                    client.set_note(Some("Recording your pets"));
                    loop {
                        match client.next(Duration::from_millis(500)) {
                            Ok(Some(m)) => {
                                if let Some((name, payload)) = feed_core::to_page(m) {
                                    let _ = app.emit(name, payload);
                                }
                            }
                            Ok(None) => {}
                            Err(_) => break,
                        }
                    }
                    set(&app, json!({ "feed": false }));
                }
                Err(Error::Refused(why)) => {
                    // a core too old or too new for us: say so once, and keep trying (it may be updated)
                    if told.as_deref() != Some(why.as_str()) {
                        set(&app, json!({ "feed": false, "refused": why }));
                        told = Some(why);
                    }
                }
                Err(_) => {}
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
