use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

/// llama-server processes we started, by name ("chat", "embed").
#[derive(Default)]
struct LlamaState(Mutex<HashMap<String, Child>>);

fn clean_instance(name: &str) -> Result<String, String> {
    if !name.is_empty() && name.len() <= 16 && name.chars().all(|c| c.is_ascii_alphanumeric()) {
        Ok(name.to_string())
    } else {
        Err("Invalid instance name".into())
    }
}

/// llama-server output goes here so we can show it when something breaks.
fn log_path(instance: &str) -> PathBuf {
    std::env::temp_dir().join(format!("mana-llama-{instance}.log"))
}

fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn start_llama(
    state: tauri::State<LlamaState>,
    instance: String,
    exe_path: String,
    model_path: String,
    port: u16,
    ctx_size: u32,
    gpu_layers: i32,
    extra_args: Vec<String>,
) -> Result<(), String> {
    let instance = clean_instance(&instance)?;
    let mut map = state.0.lock().map_err(|e| e.to_string())?;

    // Already running? Nothing to do.
    if let Some(child) = map.get_mut(&instance) {
        if let Ok(None) = child.try_wait() {
            return Ok(());
        }
    }
    map.remove(&instance);

    if !Path::new(&exe_path).is_file() {
        return Err(format!("llama-server not found at: {exe_path}"));
    }
    if !Path::new(&model_path).is_file() {
        return Err(format!("Model file not found at: {model_path}"));
    }

    let log = File::create(log_path(&instance)).map_err(|e| format!("Could not create log file: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&exe_path);
    cmd.arg("-m")
        .arg(&model_path)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("-c")
        .arg(ctx_size.to_string())
        .arg("-ngl")
        .arg(gpu_layers.to_string());
    for a in &extra_args {
        cmd.arg(a);
    }
    cmd.stdout(Stdio::from(log)).stderr(Stdio::from(log_err));

    // Run from the exe's folder so it finds its CUDA DLLs.
    if let Some(dir) = Path::new(&exe_path).parent() {
        cmd.current_dir(dir);
    }

    // Don't pop up a console window on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Could not start llama-server: {e}"))?;
    map.insert(instance, child);
    Ok(())
}

#[tauri::command]
fn stop_llama(state: tauri::State<LlamaState>, instance: String) -> Result<(), String> {
    let instance = clean_instance(&instance)?;
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = map.remove(&instance) {
        kill_child(&mut child);
    }
    Ok(())
}

#[tauri::command]
fn llama_running(state: tauri::State<LlamaState>, instance: String) -> bool {
    match state.0.lock() {
        Ok(mut map) => match map.get_mut(&instance) {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        },
        Err(_) => false,
    }
}

#[tauri::command]
fn llama_log_tail(instance: String) -> String {
    let Ok(instance) = clean_instance(&instance) else {
        return String::new();
    };
    let data = std::fs::read(log_path(&instance)).unwrap_or_default();
    let start = data.len().saturating_sub(3000);
    String::from_utf8_lossy(&data[start..]).to_string()
}

// ---------------------------------------------------------------- avatar images

fn is_image(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("png") | Some("webp") | Some("jpg") | Some("jpeg")
    )
}

/// The optional items.json in the avatar folder (item names and unlock rules).
fn is_items_file(rel: &str) -> bool {
    rel.eq_ignore_ascii_case("items.json")
}

fn collect_images(base: &Path, dir: &Path, out: &mut Vec<String>, depth: u32) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_images(base, &p, out, depth + 1);
        } else if let Ok(rel) = p.strip_prefix(base) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            if is_image(&p) || is_items_file(&rel) {
                out.push(rel);
            }
        }
    }
}

/// Lists every image under the avatar folder as relative paths ("eyes/eye_happy.png").
#[tauri::command]
async fn scan_avatar(dir: String) -> Result<Vec<String>, String> {
    let base = PathBuf::from(&dir);
    if !base.is_dir() {
        return Err(format!("Avatar folder not found: {dir}"));
    }
    let mut out = Vec::new();
    collect_images(&base, &base, &mut out, 0);
    out.sort();
    Ok(out)
}

/// Returns the raw bytes of one avatar image (only image files, only inside the folder).
#[tauri::command]
async fn read_avatar_image(dir: String, rel: String) -> Result<tauri::ipc::Response, String> {
    if rel.contains("..") {
        return Err("Invalid image path".into());
    }
    let path = PathBuf::from(&dir).join(&rel);
    if !is_image(&path) && !is_items_file(&rel) {
        return Err("Not an image file".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------------------------------------------------------------- data folder

/// Only plain "name.json" / "name.json.bak" files are allowed in the data folder.
fn valid_data_name(name: &str) -> bool {
    (name.ends_with(".json") || name.ends_with(".json.bak"))
        && name.len() > 5
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Reads a file from the data folder. Returns None if it doesn't exist yet.
#[tauri::command]
async fn data_read(dir: String, name: String) -> Result<Option<String>, String> {
    if !valid_data_name(&name) {
        return Err("Invalid data file name".into());
    }
    let path = PathBuf::from(&dir).join(&name);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Saves a file safely: write a temp file, keep the previous version as .bak, then swap it in.
#[tauri::command]
async fn data_write(dir: String, name: String, content: String) -> Result<(), String> {
    if !valid_data_name(&name) {
        return Err("Invalid data file name".into());
    }
    let base = PathBuf::from(&dir);
    std::fs::create_dir_all(&base).map_err(|e| format!("Could not create {}: {e}", base.display()))?;
    let dest = base.join(&name);
    let tmp = base.join(format!("{name}.tmp"));
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    if dest.exists() {
        let _ = std::fs::copy(&dest, base.join(format!("{name}.bak")));
    }
    std::fs::rename(&tmp, &dest).map_err(|e| format!("Could not save {}: {e}", dest.display()))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LlamaState::default())
        .invoke_handler(tauri::generate_handler![
            start_llama,
            stop_llama,
            llama_running,
            llama_log_tail,
            scan_avatar,
            read_avatar_image,
            data_read,
            data_write
        ])
        .build(tauri::generate_context!())
        .expect("error while building Mana")
        .run(|app, event| {
            // Make sure llama-server never outlives the app.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<LlamaState>() {
                    if let Ok(mut map) = state.0.lock() {
                        for (_, mut child) in map.drain() {
                            kill_child(&mut child);
                        }
                    }
                }
            }
        });
}
