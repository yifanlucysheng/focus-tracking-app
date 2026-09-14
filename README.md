# Focus Buddy

Chrome extension: lock in with a bunny or cat, track on-task tabs, friends, and stats.

Anyone can use it in Chrome **without Vite**. It is not on the Chrome Web Store until someone on the team publishes the zip (steps below). Until then, Load unpacked.

## Install (Chrome, anyone)

1. Download this repo (GitHub → Code → Download ZIP) or clone it.
2. Optional but recommended: in the project folder run `npm install` then `npm run build:extension`, then load the **`dist`** folder. If you skip that, load the **repo folder that contains `manifest.json`**.
3. Chrome → `chrome://extensions`
4. Turn on **Developer mode**
5. **Load unpacked** → select that folder
6. Pin Focus Buddy → **Open dashboard** → create an account on Settings

Reload the extension after you pull new code. If `background.js` changed, run `npm run build:extension` first.

### Features after install

| Feature | How to use it |
|---|---|
| Lock-in / timer / overlay | Popup. Works offline for lists + task words. |
| Folders, allow/block | Popup or dashboard Settings |
| Cat / bunny | Dashboard Home |
| Friends, stats, Activity | Dashboard (sign in) |
| Spotify | Settings, from the extension dashboard (not `localhost`) |
| Gemini (optional) | Settings → paste a [Gemini API key](https://aistudio.google.com/apikey) |

Gemini is optional. Without a key, lock-in still uses allow/block, work sites, folders, and task words.

## Publish to the Chrome Web Store

A bot cannot publish for you. You need a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) (one-time Google fee).

1. Run `npm run build:extension`
2. Upload `focus-buddy-extension.zip`
3. Screenshots of the popup + dashboard
4. Privacy policy URL: host `privacy.html` (this repo) or paste the same text
5. Single purpose: “Helps students stay on task with a companion overlay and session stats.”
6. Permissions justification: tabs/scripting = overlay + classify the active tab during lock-in; identity = Spotify; storage = session on device; host access = overlay on web pages

Keep the manifest `key` so the extension ID (and Spotify redirect URI) stay
`https://ckfpkmcmabbkafmnjcjfjjnbflpfjefh.chromiumapp.org/`.

## Website (optional Vite)

The in-extension dashboard is the product. `npm run dev` is only for website CSS iteration.

Accounts use **Firebase** (`web/firebase-config.js` / `secrets.public.js`).
