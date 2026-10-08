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
accessories/<depth>/   same, but placed at a depth (see below)
```

Which eyes and mouth each emotion uses, each accessory's depth, and the zoom presets all live in `src/core/avatar-map.json`.

**Accessory depth** (bottom to top): `back` (behind everything), `behind-body` (above back hair, behind the body, e.g. wings),
`behind-front-hair` (e.g. headset, glasses), `top` (above everything, the default, e.g. handheld items).
Set it by dropping the file into `accessories/<depth>/` (e.g. `accessories/behind-body/wings.png`) or by adding a line to `accessorySlots` in the JSON.

**View:** the Full / Half / Bust buttons under her, or scroll the mouse wheel over her to zoom.
After adding or changing images, press **Reload images** in the "Dress up and test" panel.

## Wardrobe and unlocks

Open **Wardrobe** under her (or from the unlock banner). Skin, outfit and hairstyle can never be empty: she always
wears her **default**, and defaults are always available. Anything that is missing, still locked, or removed
falls back to the default automatically. If her body or outfit files are missing she is not drawn at all.

Extra skins live in `base/<skin>/body.png` (the loose files in `base/` are the `default` skin). Outfits, hairstyles
and accessories work as described above.

To give an item a nicer name or make it earnable, create `items.json` in your avatar folder. The key is the item's
id: `outfits/<name>`, `hairstyles/<name>`, `base/<skin>`, or `accessories/<name>`. Items without an entry are available
from the start.

```json
{
  "outfits/summer": { "name": "Summer dress", "unlock": { "type": "days", "value": 7 } },
  "outfits/winter": { "name": "Winter coat",  "unlock": { "type": "season", "months": [12, 1, 2] } },
  "hairstyles/long": { "unlock": [ { "type": "messages", "value": 500 }, { "type": "milestone", "id": "first_game" } ] },
  "accessories/glasses": { "unlock": { "type": "skill", "value": 2 } }
}
```

A list of rules means all of them must be met. Rule types: `days` (different days you chatted), `messages`,
`skill` (Mana's coding level, nothing raises it yet), `milestone` (`first_chat` works now; `first_diary` and
`first_game` come with those features), and `season` (months 1-12). Progress counts from the day you update.
The first time something unlocks, a banner appears and Mana is told so she can react.
Reload with the **Reload images** button after editing `items.json`.

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
