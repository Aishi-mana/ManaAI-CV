use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

/// Holds the llama-server child process (if we started one).
#[derive(Default)]
struct LlamaState(Mutex<Option<Child>>);

/// llama-server output goes here so we can show it when something breaks.
fn log_path() -> PathBuf {
    std::env::temp_dir().join("mana-llama.log")
}

fn kill_child(slot: &mut Option<Child>) {
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
fn start_llama(
    state: tauri::State<LlamaState>,
    exe_path: String,
    model_path: String,
    port: u16,
    ctx_size: u32,
    gpu_layers: i32,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;

    // Already running? Nothing to do.
    if let Some(child) = slot.as_mut() {
        if let Ok(None) = child.try_wait() {
            return Ok(());
        }
    }
    *slot = None;

    if !Path::new(&exe_path).is_file() {
        return Err(format!("llama-server not found at: {exe_path}"));
    }
    if !Path::new(&model_path).is_file() {
        return Err(format!("Model file not found at: {model_path}"));
    }

    let log = File::create(log_path()).map_err(|e| format!("Could not create log file: {e}"))?;
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
        .arg(gpu_layers.to_string())
        .arg("--jinja")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

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
    *slot = Some(child);
    Ok(())
}

#[tauri::command]
fn stop_llama(state: tauri::State<LlamaState>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    kill_child(&mut *slot);
    Ok(())
}

#[tauri::command]
fn llama_running(state: tauri::State<LlamaState>) -> bool {
    match state.0.lock() {
        Ok(mut slot) => match slot.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        },
        Err(_) => false,
    }
}

#[tauri::command]
fn llama_log_tail() -> String {
    let data = std::fs::read(log_path()).unwrap_or_default();
    let start = data.len().saturating_sub(3000);
    String::from_utf8_lossy(&data[start..]).to_string()
}

fn is_image(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("png") | Some("webp") | Some("jpg") | Some("jpeg")
    )
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
        } else if is_image(&p) {
            if let Ok(rel) = p.strip_prefix(base) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
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
    if !is_image(&path) {
        return Err("Not an image file".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
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
            read_avatar_image
        ])
        .build(tauri::generate_context!())
        .expect("error while building Mana")
        .run(|app, event| {
            // Make sure llama-server never outlives the app.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<LlamaState>() {
                    if let Ok(mut slot) = state.0.lock() {
                        kill_child(&mut *slot);
                    }
                }
            }
        });
}
