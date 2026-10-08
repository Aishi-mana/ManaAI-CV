# Mana

A local daughter-companion AI. Step 1: a chat window that launches `llama-server` and talks to your GGUF model.

## Run it

```powershell
npm install
npm run tauri dev
```

The first run compiles the Rust side and takes several minutes. Later runs are fast.

## First launch

1. Click **Settings**.
2. Check the **llama-server file** (it is prefilled with `C:\ai\llama-cpp\llama-server.exe`).
3. **Browse** for a model, for example `Qwen3-8B-Q4_K_M.gguf`.
4. Type your name under **Your name**, then **Save settings**.
5. Click **Start model**. The pill turns green when it is ready, then say hi.

Settings and chat history are kept between launches (stored by the app's webview for now; they move into `data/` in a later step).

## Avatar (step 2)

Mana's paper doll is built from the PNGs in your avatar folder (Settings -> Avatar folder). Expected layout:

```
base/            body.png
eyes/            eye_<name>.png      (one per look, plus eye_closed and eye_half_closed for blinking)
mouth/           mouth_<name>.png    (rest mouths) and mouth_a/e/i/o/u.png (lip sync)
hairstyles/<style>/   hair_back.png (behind the body), hair_front.png, hair_ahoge.png ...
outfits/<name>/       outfit.png      (a file with "_back" in its name goes behind the body)
accessories/     any .png, toggled from "Dress up and test"
```

Which eyes and mouth each emotion uses lives in `src/core/avatar-map.json`. Edit it if a look doesn't match.
After adding or changing images, press **Reload images** in the "Dress up and test" panel.

## Notes

- If you already have a `llama-server` running on port 8080 (for example from a manual test), Mana will use it and show "Ready". Close it first if you want Mana to launch its own with your chosen model.
- If the model fails to start, the red box shows the end of llama-server's log. The full log is at `%TEMP%\mana-llama.log`.
- Reasoning models (DeepSeek R1 and similar) may print long thinking text. Mana hides `<think>` blocks, but they are slow, so use a normal chat model.
- `npm run dev` alone opens the UI in a browser tab and talks to an already-running llama-server (no Start button magic). Use `npm run tauri dev` for the real app.

## Layout

```
src/            React UI
src/core/       settings, prompt building, LLM streaming, emotion tags
src/components/ chat, settings drawer, avatar stage (placeholder)
src-tauri/      Rust shell: starts and stops llama-server
```
