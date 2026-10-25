// The overlay's A2 Tools settings edits (src-tauri/src/setup_core.rs, included as is).
#[path = "../../../overlay/src-tauri/src/setup_core.rs"]
mod setup_core;
use setup_core::*;
use std::collections::BTreeMap;

fn get(t: &str) -> BTreeMap<String, String> { serde_json::from_str(t).unwrap() }
fn list(t: &str) -> Vec<String> { serde_json::from_str(&get(t)[DEV_FOLDERS_KEY]).unwrap() }

fn main() {
    let mut ok = true;
    let mut check = |name: &str, cond: bool| { println!("{} {name}", if cond { "✅" } else { "❌" }); ok &= cond; };
    let dir = r"C:\Users\Player\AppData\Local\Programs\AION 2 Pet Farm Guide\farm-guide";
    let old = r"C:\Users\Player\Downloads\Farm-Guide-1.15.2\farm-guide";
    let other = r"D:\plugins\boss-timer";
    let fg = |f: &str| same_path(f, old);

    // a meter that never had developer mode
    let fresh = r#"{"dpsMeter.language":"en","dpsMeter.overlayLocked":"false"}"#;
    let t = with_folder(fresh, dir, fg).unwrap().unwrap();
    check("fresh: developer mode on", get(&t)[DEV_MODE_KEY] == "true");
    check("fresh: our folder listed", list(&t) == vec![dir.to_string()]);
    check("fresh: other settings kept", get(&t)["dpsMeter.language"] == "en" && get(&t)["dpsMeter.overlayLocked"] == "false");
    check("fresh: every value still a string (A2 Tools reads string → string)", serde_json::from_str::<BTreeMap<String, String>>(&t).is_ok());
    check("again: nothing to change", with_folder(&t, dir, fg).unwrap().is_none());
    check("again, other case and slashes: nothing to change", with_folder(&t, &dir.to_uppercase().replace('\\', "/"), fg).unwrap().is_none());

    // someone who loaded an older copy by hand, next to another plugin
    let legacy = serde_json::json!({ DEV_MODE_KEY: "true", DEV_FOLDERS_KEY: serde_json::to_string(&[old, other]).unwrap(), "x": "1" }).to_string();
    let t = with_folder(&legacy, dir, fg).unwrap().unwrap();
    check("legacy: the old copy is replaced, the other plugin stays", list(&t) == vec![other.to_string(), dir.to_string()]);
    check("legacy: unrelated setting kept", get(&t)["x"] == "1");

    // developer mode turned off by the player, folder still listed: turned back on
    let off = serde_json::json!({ DEV_MODE_KEY: "false", DEV_FOLDERS_KEY: serde_json::to_string(&[dir]).unwrap() }).to_string();
    let t = with_folder(&off, dir, fg).unwrap().unwrap();
    check("dev mode off: on again, list unchanged", get(&t)[DEV_MODE_KEY] == "true" && list(&t) == vec![dir.to_string()]);

    // a file A2 Tools wouldn't write: left alone
    check("non-string value: refused", with_folder(r#"{"a":1}"#, dir, fg).is_err());
    check("not JSON: refused", with_folder("{oops", dir, fg).is_err());
    check("BOM: read fine", with_folder(&format!("\u{feff}{fresh}"), dir, fg).unwrap().is_some());

    // uninstall
    let both = serde_json::json!({ DEV_MODE_KEY: "true", DEV_FOLDERS_KEY: serde_json::to_string(&[other, dir]).unwrap() }).to_string();
    let t = without_folder(&both, dir).unwrap().unwrap();
    check("uninstall: only ours goes, dev mode stays for the other", list(&t) == vec![other.to_string()] && get(&t)[DEV_MODE_KEY] == "true");
    let only = serde_json::json!({ DEV_MODE_KEY: "true", DEV_FOLDERS_KEY: serde_json::to_string(&[dir]).unwrap() }).to_string();
    let t = without_folder(&only, dir).unwrap().unwrap();
    check("uninstall: last folder gone, dev mode off", list(&t).is_empty() && get(&t)[DEV_MODE_KEY] == "false");
    check("uninstall: not listed, nothing to change", without_folder(fresh, dir).unwrap().is_none());
    std::process::exit(if ok { 0 } else { 1 });
}
