# Focus Buddy

> **Demo branch:** use [`local/final-preview`](https://github.com/yifanlucysheng/focus-tracking-app/tree/local/final-preview). That is the current build to try and share.

Chrome extension: lock in with a bunny or cat, track on-task tabs, friends, and stats.

Anyone can use it in Chrome **without Vite**. It is not on the Chrome Web Store until someone on the team publishes the zip (steps below). Until then, Load unpacked.

## Install from GitHub

```bash
git clone https://github.com/yifanlucysheng/focus-tracking-app.git
cd focus-tracking-app
git checkout local/final-preview
npm install
npm run build:extension
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

Pin Focus Buddy, open the popup, then **Open dashboard**. Create an account on Settings.

After code changes, run `npm run build:extension` again and click **Reload** on the extension card.

### Features after install

| Feature | How to use it |
|---|---|
| Lock-in / timer / overlay | Popup. Works offline for lists + task words. |
| Folders, allow/block | Popup or dashboard Settings |
| Cat / bunny | Dashboard Home |
| Friends, stats, Activity | Dashboard (sign in) |
| Spotify | Settings, from the extension dashboard (not `localhost`) |
| Gemini (optional) | Settings → paste a [Gemini API key](https://aistudio.google.com/apikey) |

Gemini is optional. Without a key, lock-in still uses allow/block, work sites, folders, and task words. Do not commit `secrets.local.js`.

### Accounts and cloud sync

Accounts use **Firebase** (`web/firebase-config.js` / `secrets.public.js`). Client keys are already in the repo.

For friends, stats sync, and messaging to work for new users, publish [`firestore.rules`](firestore.rules) in Firebase Console → Firestore → Rules, and keep Email auth enabled.

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
