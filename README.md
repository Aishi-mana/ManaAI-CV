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

## Data folder and memory

Settings, chat history, your progress, her outfit and her memories are saved as small files in one data folder
(default `C:\AI\ManaAI-CV\data`; change it in Settings, then restart): `settings.json`, `chat.json`, `stats.json`,
`avatar.json`, `memory.json`, `persona.json`, `diary.json`, `initiative.json`. To back her up, copy the folder. Every save keeps the previous version as `.json.bak`.
The first time you start this version, anything you had saved before is moved in automatically.

**How memory works.** Every few messages (or after a minute of quiet) the chat model reads the new part of the
conversation and writes a few short memories with an importance from 1 to 10. Each memory has a strength that fades
over time: small talk fades in days, big moments last weeks to months, emotional ones last longer. Every time a memory
comes up it gets stronger and fades more slowly. Below 15% a memory is *faint*: it isn't recalled normally, but asking
"do you remember...?" can bring it back, and she'll say she only half remembers. **Pinned** memories never fade and are
always in her prompt. Open **Memories** to read, search, pin, edit, add or delete anything. Memories store
`{{user}}` / `{{char}}` instead of names, so renaming either of you never leaves stale memories.

**Searching by meaning (optional).** Without extra setup, Mana finds memories by matching words. For paraphrases
("outdoor plans" finding "enjoys hiking"), download a small embedding model, for example
`bge-small-en-v1.5-q8_0.gguf` (about 36 MB) from the `CompendiumLabs/bge-small-en-v1.5-gguf` page on Hugging Face,
set it as the **Embedding model** in Settings, and press Start model. It runs on the CPU, so it doesn't use VRAM.
Existing memories are indexed automatically. If the model is later changed, memories are re-indexed.

The numbers that decide what comes to mind (`MIN_REL`, `EMBED_LO`, `EMBED_HI`) are at the top of
`src/core/memory/recall.ts`. The Memories window shows the match score of each recall so you can tune them.
llama-server logs are in `%TEMP%\mana-llama-chat.log` and `%TEMP%\mana-llama-embed.log`.

## Mood, personality and her diary

**Mood** changes quickly. It follows the time of day (sleepy at 3 AM), how long you have been away (she gets lonely,
more so if her *clinginess* is high, and is delighted when you come back), and how the chat goes (her own happy,
sad or worried replies nudge it, softly). It fades back to her resting mood over a few hours. When she has been quiet for
a bit, her face shows her mood instead of her last reply's emotion. Her mood and bond reach the chat model as plain
sentences ("It is late at night. {{char}} feels very sleepy..."), never as numbers.

**Personality** has five traits (cheerfulness, shyness, clinginess, curiosity, sass). In **Mood & diary > Personality**
you set where each rests. How you two talk nudges them very slowly (roughly 10-20 similar days to move one all the way),
but never more than 0.2 away from the value you set. **Reset drift** puts them back. The drift rules are in
`src/core/persona/reflect.ts` (`driftFromDay`).

**Bond** only grows: 1 point for each day you chat, plus up to 2 for happy moments. Stages: Getting to know you (0),
Friends (15), Close (40), Inseparable (80). It changes how warm and familiar she is.

**Sleep cycle.** After about 10 quiet minutes following a real conversation (at least 4 of your messages, at most once
every 6 hours), or when you press "Let her rest and reflect now", she: turns the day into memories, tidies them (near-duplicates
are merged, lasting facts such as a birthday become "always remembered" unless you unpinned them), writes a diary entry
from what she actually remembers (she is told not to invent events), and updates her personality drift and bond.
Days when you talk about coding or games also count toward her **coding level** (1 level per 5 such days), which
unlocks items with a `skill` rule. Turn the automatic part off in Settings.

New unlock rule for `items.json`: `{ "type": "bond", "value": 40 }`.

## Starting conversations (initiative)

Mana can start a conversation herself. She only does it when the model is ready, you have been idle for a while
(about 20 minutes on "Normal"; less if she is lonely), you are not typing or in a menu, it isn't your quiet hours
(default 23:00 to 08:00), she isn't sleepy, and she hasn't hit her daily limit (Rarely 3, Normal 6, Often 10).
What she says depends on the moment: a follow-up on something she remembers ("how did your exam go?", never the same
one twice within 5 days), a warm hello when you open the app after 6+ hours away, "I miss you" when she is lonely,
a get-to-know-you question (she is told not to ask what she already knows), a small idea she is excited about (she may not
claim she built anything), or a morning or evening check-in.

After she asks, she **waits** (her face looks expectant and the caption says so). If you haven't answered after the wait
time (default 5 minutes) she feels a little ignored (a small mood dip) and goes quiet. **She never sends a second message
until you reply.** If the window isn't in front, the taskbar button flashes, and a soft chime plays (both optional).
Settings > Starting conversations has the controls, and **Let her start a chat now** to try it.
Her openers are marked "started this" under the message and are not counted as something you said.

## Notes

- If you already have a `llama-server` running on port 8080 (for example from a manual test), Mana will use it and show "Ready". Close it first if you want Mana to launch its own with your chosen model.
- If the model fails to start, the red box shows the end of llama-server's log. The full log is at `%TEMP%\mana-llama-chat.log`.
- Reasoning models (DeepSeek R1 and similar) may print long thinking text. Mana hides `<think>` blocks, but they are slow, so use a normal chat model.
- `npm run dev` alone opens the UI in a browser tab and talks to an already-running llama-server (no Start button magic). Use `npm run tauri dev` for the real app.

## Layout

```
src/            React UI
src/core/       settings, prompt building, LLM streaming, emotion tags
src/components/ chat, settings drawer, avatar stage (placeholder)
src-tauri/      Rust shell: starts and stops llama-server
```
