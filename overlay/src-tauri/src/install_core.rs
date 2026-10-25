//! What the overlay writes for Flav-Toolkit beside itself and in Flav-Toolkit's folder, with no
//! window and no files (pure), so tests/install_core runs it as it is.
//!
//! - `addon.json` (ADDONS.md section 3): the template in the repository (overlay/addon.json), with
//!   the version of the plugin beside it, which is the release's (an update of the plugin moves it).
//! - The link (`addon-links\pet-farm-guide.json`): `{"dir": "<the folder of addon.json>"}`, how the
//!   hub finds a copy its own installer placed.

use serde_json::Value;

/// The add-on's `addon.json`, its version set to the plugin's. Refuses a template that isn't ours.
pub fn addon_json(template: &str, version: &str) -> Result<String, String> {
    let mut m: Value = serde_json::from_str(template.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
    if m.get("id").and_then(Value::as_str) != Some("pet-farm-guide") {
        return Err("not Pet Farm Guide's addon.json".into());
    }
    let ok = !version.is_empty() && version.split('.').count() == 3 && version.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    if !ok {
        return Err(format!("{version:?} is not a version"));
    }
    m["version"] = Value::from(version);
    serde_json::to_string_pretty(&m).map(|s| s + "\n").map_err(|e| e.to_string())
}

/// The plugin's version, from its manifest.json.
pub fn plugin_version(manifest: &str) -> Option<String> {
    let m: Value = serde_json::from_str(manifest.trim_start_matches('\u{feff}')).ok()?;
    if m.get("id").and_then(Value::as_str) != Some("farm-guide") {
        return None;
    }
    m.get("version").and_then(Value::as_str).map(String::from)
}

/// The link file's text for a folder.
pub fn link_json(dir: &str) -> String {
    serde_json::json!({ "dir": dir }).to_string()
}

/// Whether a link file names this folder (case, slash direction and a trailing separator don't
/// matter, as on Windows).
pub fn link_is(text: &str, dir: &str) -> bool {
    let norm = |p: &str| p.trim().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}'))
        .ok()
        .and_then(|v| v.get("dir").and_then(Value::as_str).map(norm))
        .is_some_and(|d| d == norm(dir))
}
