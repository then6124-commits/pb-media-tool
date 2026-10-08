use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchChromeResult {
    ok: bool,
    browser_id: u32,
    profile_dir: String,
    chrome_path: String,
    url: String,
    detail: String,
}

fn chrome_exe() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CHROME_PATH") {
        let pb = PathBuf::from(&p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for c in candidates {
        let pb = PathBuf::from(c);
        if pb.is_file() {
            return Some(pb);
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let pb = PathBuf::from(local)
            .join("Google")
            .join("Chrome")
            .join("Application")
            .join("chrome.exe");
        if pb.is_file() {
            return Some(pb);
        }
    }
    None
}

/// Mirror MUSE TOOL: %LOCALAPPDATA%\PBMedia\chrome_flow_accounts\browser_N
fn profile_dir(browser_id: u32) -> PathBuf {
    let n = browser_id.clamp(1, 4);
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
        format!(r"{}\AppData\Local", home)
    });
    PathBuf::from(local)
        .join("PBMedia")
        .join("chrome_flow_accounts")
        .join(format!("browser_{n}"))
}

fn allowed_url(url: &str) -> bool {
    url.starts_with("https://labs.google/")
        || url.starts_with("https://flow.google.com/")
        || url.starts_with("https://accounts.google.com/")
}

#[tauri::command]
fn launch_chrome_for_browser(
    browser_id: u32,
    url: Option<String>,
    email: Option<String>,
) -> LaunchChromeResult {
    let browser_id = browser_id.clamp(1, 4);
    let mut url = url
        .unwrap_or_else(|| "https://accounts.google.com/AddSession?hl=vi&continue=https%3A%2F%2Fflow.google.com%2F".into())
        .trim()
        .to_string();
    if !allowed_url(&url) {
        url = "https://accounts.google.com/AddSession?hl=vi&continue=https%3A%2F%2Fflow.google.com%2F".into();
    }
    let dir = profile_dir(browser_id);
    if let Err(e) = fs::create_dir_all(&dir) {
        return LaunchChromeResult {
            ok: false,
            browser_id,
            profile_dir: dir.display().to_string(),
            chrome_path: String::new(),
            url,
            detail: format!("Không tạo được profile dir: {e}"),
        };
    }
    if let Some(em) = email {
        let em = em.trim().to_string();
        if em.contains('@') {
            let _ = fs::write(dir.join("pbmedia_email.txt"), format!("{em}\n"));
        }
    }
    let Some(chrome) = chrome_exe() else {
        return LaunchChromeResult {
            ok: false,
            browser_id,
            profile_dir: dir.display().to_string(),
            chrome_path: String::new(),
            url,
            detail: "Không tìm thấy chrome.exe".into(),
        };
    };
    // Normal Chrome login: persistent profile only. No automation / CDP flags.
    // Mirrors MUSE trust args for visible login; Google rejects --enable-automation.
    let user_data = format!("--user-data-dir={}", dir.display());
    let launch = Command::new(&chrome)
        .arg(&user_data)
        .arg("--disable-dev-shm-usage")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-infobars")
        .arg("--disable-popup-blocking")
        .arg("--disable-background-timer-throttling")
        .arg("--disable-backgrounding-occluded-windows")
        .arg("--disable-renderer-backgrounding")
        .arg("--lang=vi-VN")
        .arg("--window-size=1400,900")
        .arg("--hide-crash-restore-bubble")
        .arg("--disable-session-crashed-bubble")
        .arg("--disable-default-apps")
        .arg("--new-window")
        .arg(&url)
        .spawn();
    match launch {
        Ok(_) => LaunchChromeResult {
            ok: true,
            browser_id,
            profile_dir: dir.display().to_string(),
            chrome_path: chrome.display().to_string(),
            url,
            detail: format!("Browser {browser_id} da mo (Chrome thuong) — {}", dir.display()),
        },
        Err(e) => LaunchChromeResult {
            ok: false,
            browser_id,
            profile_dir: dir.display().to_string(),
            chrome_path: chrome.display().to_string(),
            url,
            detail: format!("Spawn Chrome lỗi: {e}"),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![launch_chrome_for_browser])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
