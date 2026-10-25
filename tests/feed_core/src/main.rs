// The overlay's feed rules (src-tauri/src/feed_core.rs, included as is) against a real Flav-Toolkit
// feed at the pinned commit: our hello is welcomed, the kept pet list comes after who-you-are, and
// each message becomes what the page expects.
#[path = "../../../overlay/src-tauri/src/feed_core.rs"]
mod feed_core;

use std::time::{Duration, Instant};

use flav_events::feed::{CoreStatus, Show, Source};
use flav_feed::{Feed, Options};
use flav_sdk::{Client, Event, EventKind};
use serde_json::{json, Value};

fn ev(at_ms: i64, kind: EventKind) -> Event {
    Event { at_ms, kind }
}
fn decoded(at_ms: i64, decoder: &str, data: Value) -> Event {
    ev(at_ms, EventKind::Decoded { plugin: "farm-guide".into(), decoder: decoder.into(), data })
}
/// What the page would get within `wait`.
fn page(client: &mut Client, wait: Duration) -> Vec<(&'static str, Value)> {
    let until = Instant::now() + wait;
    let mut out = Vec::new();
    while Instant::now() < until {
        if let Ok(Some(m)) = client.next(Duration::from_millis(50)) {
            out.extend(feed_core::to_page(m));
        }
    }
    out
}

fn main() {
    let mut ok = true;
    let mut check = |name: &str, cond: bool, detail: &dyn std::fmt::Debug| {
        println!("{} {name}{}", if cond { "✅" } else { "❌" }, if cond { String::new() } else { format!("  ({detail:?})") });
        ok &= cond;
    };
    let dir = std::env::temp_dir().join(format!("fg-feed-core-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let feed = Feed::start(Options { dir: dir.clone(), port: 0, core: "0.3.0 (test)".into() }).expect("feed");
    // what addon.json's `keep` asks for
    feed.keep_decoded([("farm-guide".to_string(), "pet-list".to_string()), ("farm-guide".to_string(), "map-load".to_string())]);
    let list = json!({ "levels": [{ "pet": 1015, "level": 1 }], "points": [{ "pet": 1015, "points": 3 }] });
    feed.publish(&ev(1000, EventKind::MyServer { server: 1012 }));
    feed.publish(&ev(1000, EventKind::MyProfile { name: "Sampleton".into(), class: Some("Cleric".into()), level: Some(45) }));
    feed.publish(&decoded(1001, "pet-list", list.clone()));
    feed.publish(&decoded(1002, "soul-gained", json!({ "souls": [{ "pet": 1015, "amount": 1 }] }))); // before we connect: not kept
    feed.publish(&decoded(1003, "map-load", json!({ "map": 2001 })));

    let addon_json = r#"{"schema":1,"id":"pet-farm-guide","version":"1.24.0"}"#;
    let mut config = feed_core::config(Some(addon_json));
    config.dir = Some(dir.clone());
    check("the hello carries addon.json's version", config.version == "1.24.0", &config.version);
    let client = Client::connect(&config);
    check("Flav-Toolkit welcomes our hello (id and every type we ask for)", client.is_ok(), &client.as_ref().err());
    let mut client = client.unwrap();
    // the core's status may come in between (every 2 s): only the events count here
    let got: Vec<(&str, Value)> = page(&mut client, Duration::from_millis(500)).into_iter().filter(|(n, _)| *n == "feed").collect();
    let types: Vec<String> = got.iter().map(|(n, v)| format!("{n}:{}", v["type"].as_str().unwrap_or("?"))).collect();
    // the order inside each group is the core's (its maps); what the page needs: who you are first
    let first_decoded = got.iter().position(|(_, v)| v["type"] == "decoded").unwrap_or(got.len());
    let state: Vec<&Value> = got[..first_decoded].iter().map(|(_, v)| v).collect();
    let kept: Vec<&Value> = got[first_decoded..].iter().map(|(_, v)| v).collect();
    check("who you are first (my_server, my_profile), then the kept decoders", state.len() == 2 && kept.len() == 2 && kept.iter().all(|v| v["type"] == "decoded"), &types);
    let find = |t: &str| state.iter().find(|v| v["type"] == t).copied().cloned().unwrap_or_default();
    check("the server and the profile as the page reads them", find("my_server")["server"] == 1012 && find("my_profile")["name"] == "Sampleton" && find("my_profile")["level"] == 45, &state);
    let pl = kept.iter().find(|v| v["decoder"] == "pet-list").copied().cloned().unwrap_or_default();
    check("the kept pet list: plugin, decoder, its own time and A2 Tools' data", pl["plugin"] == "farm-guide" && pl["at_ms"] == 1001 && pl["data"] == list, &pl);
    check("the kept map too", kept.iter().any(|v| v["decoder"] == "map-load" && v["data"]["map"] == 2001), &kept);
    check("a pickup from before we connected is not handed over", !got.iter().any(|(_, v)| v["decoder"] == "soul-gained"), &types);

    feed.publish(&decoded(2000, "soul-gained", json!({ "souls": [{ "pet": 1015, "amount": 1 }, { "pet": 1120, "amount": 1 }] })));
    feed.publish(&ev(2001, EventKind::Died { id: 9 })); // not asked for
    feed.set_status(CoreStatus { capturing: true, game: true, source: Source::Live, text: "Reading the game".into(), exchange: None });
    let _ = feed.show("pet-farm-guide", Show::Settings);
    let got = page(&mut client, Duration::from_millis(700));
    let names: Vec<&str> = got.iter().map(|(n, _)| *n).collect();
    check("a live pickup reaches the page, with both pets", got.iter().any(|(n, v)| *n == "feed" && v["decoder"] == "soul-gained" && v["data"]["souls"].as_array().map(|a| a.len()) == Some(2)), &got);
    check("only what we asked for", !got.iter().any(|(_, v)| v["type"] == "died"), &names);
    check("the core's status → feed-status", got.iter().any(|(n, v)| *n == "feed-status" && v["capturing"] == true && v["text"] == "Reading the game"), &names);
    check("the hub's Settings → show settings", got.iter().any(|(n, v)| *n == "show" && v == "settings"), &names);
    check("we ask for the dock's toggle, and the core grants it", client.features.iter().any(|f| f == "toggle"), &client.features);
    let _ = feed.show("pet-farm-guide", Show::Toggle);
    let got = page(&mut client, Duration::from_millis(500));
    check("the dock's icon → show toggle", got.iter().any(|(n, v)| *n == "show" && v == "toggle"), &got);
    std::process::exit(if ok { 0 } else { 1 });
}
