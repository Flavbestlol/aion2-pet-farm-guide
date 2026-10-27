//! The feed's rules with no window (Tauri-free), so tests/feed_core runs them against a real
//! Flav-Toolkit feed: what we ask for, and what each message from the core becomes for the page.

use flav_sdk::{Config, Message, SettingsGroup, Show};
use serde_json::{json, Value};

/// Our id in Flav-Toolkit (addon.json `id`).
pub const ADDON_ID: &str = "pet-farm-guide";

/// Every event Farm Guide uses: its four decoders, and who and where the player is.
pub const TYPES: [&str; 6] = ["decoded:pet-list", "decoded:soul-gained", "decoded:level-up", "decoded:map-load", "my_server", "my_profile"];

/// The version the hub shows: addon.json's beside the exe (the package's), else this build's own
/// (the same number: the overlay carries the add-on's version).
pub fn addon_version(addon_json: Option<&str>) -> String {
    addon_json
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|m| m.get("version").and_then(Value::as_str).map(String::from))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

/// The hello: our id, the version the hub shows, and what we want.
pub fn config(addon_json: Option<&str>) -> Config {
    Config::new(ADDON_ID, &addon_version(addon_json), &TYPES).features(&FEATURES)
}

/// What we understand beyond events (`hello`'s `features`). `toggle` (core 0.12.0): the dock's icon
/// shows the guide, and a second click hides it. `settings` (core 0.18.0): the guide's settings in
/// the hub, some shared with every add-on (ADDONS.md section 4d). An older core ignores both.
pub const FEATURES: [&str; 2] = ["toggle", "settings"];

/// The page's description of its settings, as the hub takes it (`None`: not one, or larger than
/// the feed takes in one message). The core checks and cuts it again on its side.
pub fn settings_from_page(v: Value) -> Option<Vec<SettingsGroup>> {
    if serde_json::to_vec(&v).map_or(true, |b| b.len() > 200 * 1024) {
        return None;
    }
    serde_json::from_value(v).ok()
}

/// What a message from the core becomes for the page: an event name and its payload (`None`:
/// nothing to pass on).
pub fn to_page(m: Message) -> Option<(&'static str, Value)> {
    match m {
        Message::Event(e) => serde_json::to_value(&e).ok().map(|v| ("feed", v)),
        // a newer core's event: the page skips what it doesn't know
        Message::Unknown(v) => Some(("feed", v)),
        Message::Status(s) => serde_json::to_value(&s).ok().map(|v| ("feed-status", v)),
        Message::Show(what) => Some(("show", Value::from(match what {
            Show::Settings => "settings",
            Show::Toggle => "toggle",
            _ => "open",
        }))),
        // the player changed one of our settings in the hub: the page applies it and describes again
        Message::Setting { key, value } => Some(("setting", json!({ "key": key, "value": value }))),
        // what we didn't ask for (the lock, keys, layout): nothing for the page
        _ => None,
    }
}
