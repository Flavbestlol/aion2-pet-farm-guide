// What the overlay writes for Flav-Toolkit's hub (src-tauri/src/install_core.rs, included as is):
// addon.json from the repository's template with the plugin's version, and the link file.
#[path = "../../../overlay/src-tauri/src/install_core.rs"]
mod install_core;
use install_core::*;

fn main() {
    let mut ok = true;
    let mut check = |name: &str, cond: bool| { println!("{} {name}", if cond { "✅" } else { "❌" }); ok &= cond; };
    let template = include_str!("../../../addon.json");
    let out = addon_json(template, "1.24.0").unwrap();
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    check("addon.json takes the plugin's version", v["version"] == "1.24.0");
    check("the rest is the template's", v["id"] == "pet-farm-guide" && v["decoders"]["manifest"] == "farm-guide/manifest.json" && v["run"]["exe"] == "Farm Guide Overlay.exe");
    check("a version that isn't one is refused", addon_json(template, "1.2").is_err() && addon_json(template, "1.2.x").is_err() && addon_json(template, "").is_err());
    check("another add-on's template is refused", addon_json(r#"{"id":"death-recap"}"#, "1.0.0").is_err());
    check("the plugin's version from its manifest", plugin_version(include_str!("../../../plugin/farm-guide/manifest.json")).is_some());
    check("another plugin's manifest isn't ours", plugin_version(r#"{"id":"other","version":"1.0.0"}"#).is_none());
    let dir = r"C:\Users\Player\AppData\Local\Programs\AION 2 Pet Farm Guide";
    let link = link_json(dir);
    check("the link holds the folder, escaped as JSON", serde_json::from_str::<serde_json::Value>(&link).unwrap()["dir"] == dir);
    check("the link names this folder, however Windows spells it", link_is(&link, &dir.to_lowercase().replace('\\', "/")) && link_is(&link, &format!("{dir}\\")));
    check("another folder's link isn't ours", !link_is(&link, r"D:\Games\Pet Farm Guide") && !link_is("", dir) && !link_is("{ broken", dir));
    std::process::exit(if ok { 0 } else { 1 });
}
