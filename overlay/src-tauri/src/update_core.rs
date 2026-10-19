//! The update's checks, kept free of the app so they can be tested on their own (tests/update_core):
//! the publisher's signature, the checksums, and what a plugin zip may hold.

use std::io::Read;
use std::path::PathBuf;

use sha2::{Digest, Sha256};

pub const PUBLIC_KEY: &str = "a966e298f02e38d4c8b1230b1116620dfd8819fa5bbca63e5491baee57aae8ef";
pub const MAX_ZIP: u64 = 32 * 1024 * 1024;
/// What a plugin may hold (A2 Tools' own catalog rules).
pub const PLUGIN_TYPES: [&str; 12] = ["html", "js", "css", "json", "png", "jpg", "jpeg", "webp", "svg", "gif", "md", "txt"];

pub fn unhex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let s = s.trim();
    if s.len() != N * 2 {
        return None;
    }
    let mut out = [0u8; N];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Were these exact bytes signed with the publisher's key? `sig` is the signature in hex.
pub fn signed(body: &[u8], sig: &str) -> Result<(), String> {
    let key = ed25519_dalek::VerifyingKey::from_bytes(&unhex::<32>(PUBLIC_KEY).ok_or("bad key")?).map_err(|_| "bad key")?;
    let sig = unhex::<64>(sig).ok_or("the release's signature is unreadable")?;
    key.verify_strict(body, &ed25519_dalek::Signature::from_bytes(&sig))
        .map_err(|_| "the release isn't signed by the publisher: not installing it".to_string())
}

/// The zip's files, paths relative to the plugin folder (its top `farm-guide/` folder dropped).
pub fn unzip_plugin(bytes: &[u8]) -> Result<Vec<(PathBuf, Vec<u8>)>, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("the update is unreadable ({e})"))?;
    let mut out = Vec::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let Some(name) = f.enclosed_name() else { return Err("the update has a bad path".into()) };
        let rel: PathBuf = name.components().skip(1).collect();
        if rel.as_os_str().is_empty() {
            continue;
        }
        let ext = rel.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !PLUGIN_TYPES.contains(&ext.as_str()) {
            return Err(format!("the update holds a file a plugin may not have: {}", rel.display()));
        }
        total += f.size();
        if total > MAX_ZIP * 2 {
            return Err("the update is larger than expected".into());
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut data).map_err(|e| e.to_string())?;
        out.push((rel, data));
    }
    Ok(out)
}
