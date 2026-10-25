//! Adding Farm Guide's plugin folder to A2 Tools, as its Settings › Plugins › Load plugin folder…
//! does. Pure (text in, text out), so it's tested on its own (tests/setup_core).
//!
//! A2 Tools keeps settings.json as one flat object of strings. Developer mode is
//! `"dpsMeter.pluginDevMode": "true"`; its folders are `"dpsMeter.devPlugins"`, a JSON array written
//! as a string. A2 Tools reads the file as string → string and starts from nothing if that fails, so
//! a file that isn't exactly that shape is left alone.

use std::collections::BTreeMap;

pub const DEV_MODE_KEY: &str = "dpsMeter.pluginDevMode";
pub const DEV_FOLDERS_KEY: &str = "dpsMeter.devPlugins";

type Settings = BTreeMap<String, String>;

/// The same folder as Windows sees it: case, slash direction and a trailing separator don't matter.
pub fn same_path(a: &str, b: &str) -> bool {
    norm(a) == norm(b)
}
fn norm(p: &str) -> String {
    p.trim().replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn parse(text: &str) -> Result<Settings, String> {
    let text = text.trim_start_matches('\u{feff}');
    serde_json::from_str(text).map_err(|e| format!("A2 Tools' settings file isn't in the shape it writes ({e})"))
}
fn folders(s: &Settings) -> Vec<String> {
    s.get(DEV_FOLDERS_KEY).and_then(|v| serde_json::from_str(v).ok()).unwrap_or_default()
}
fn dev_on(s: &Settings) -> bool {
    s.get(DEV_MODE_KEY).map(String::as_str) == Some("true")
}
fn write(mut s: Settings, list: &[String], dev: bool) -> String {
    s.insert(DEV_MODE_KEY.into(), if dev { "true" } else { "false" }.into());
    s.insert(DEV_FOLDERS_KEY.into(), serde_json::to_string(list).unwrap_or_else(|_| "[]".into()));
    serde_json::to_string_pretty(&s).unwrap_or_default()
}

/// The settings with `dir` loaded in developer mode; `None` when that's already so.
/// A2 Tools loads one folder per plugin (the first listed), so any other folder holding Farm Guide
/// (`is_farm_guide`, such as an older copy you extracted by hand) is taken off the list. Every other
/// folder and setting stays as it was.
pub fn with_folder(text: &str, dir: &str, is_farm_guide: impl Fn(&str) -> bool) -> Result<Option<String>, String> {
    let s = parse(text)?;
    let before = folders(&s);
    let mut list: Vec<String> = before.iter().filter(|f| same_path(f, dir) || !is_farm_guide(f)).cloned().collect();
    if !list.iter().any(|f| same_path(f, dir)) {
        list.push(dir.to_string());
    }
    if dev_on(&s) && list == before {
        return Ok(None);
    }
    Ok(Some(write(s, &list, true)))
}

/// The settings without `dir`; `None` when it isn't listed. Developer mode goes off with the last
/// folder, as it was before the guide turned it on.
pub fn without_folder(text: &str, dir: &str) -> Result<Option<String>, String> {
    let s = parse(text)?;
    let before = folders(&s);
    let list: Vec<String> = before.iter().filter(|f| !same_path(f, dir)).cloned().collect();
    if list.len() == before.len() {
        return Ok(None);
    }
    let dev = dev_on(&s) && !list.is_empty();
    Ok(Some(write(s, &list, dev)))
}
