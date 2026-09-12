# Focus Buddy

> **Demo branch:** use [`local/final-preview`](https://github.com/yifanlucysheng/focus-tracking-app/tree/local/final-preview). That is the current build to try and share.

Chrome extension for focus tracking, with a dashboard, friends, and a lock-in companion.

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

### Optional: Gemini

Gemini improves on-task vs distracted classification for unknown sites. It is not required.

To enable it locally, copy `secrets.local.example.js` → `secrets.local.js` and set `GEMINI_API_KEY`. Do not commit `secrets.local.js`.

### Accounts and cloud sync

Accounts use **Firebase** (`web/firebase-config.js` / `secrets.public.js`). Client keys are already in the repo.

For friends, stats sync, and messaging to work for new users, publish [`firestore.rules`](firestore.rules) in Firebase Console → Firestore → Rules, and keep Email auth enabled.

## Website (local Vite / Supabase)

The friends/account UI also lives in `web/` and can be run with Vite.

### 1. Install

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` → `.env.local` and fill in values from
**Supabase → Project Settings → API**:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Project URL (e.g. `https://xxxx.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) — never the secret key |

Never commit `.env.local`.

### 3. Create the `profiles` table

In the Supabase SQL Editor, run the full script:

[`supabase/profiles.sql`](supabase/profiles.sql)

That creates `profiles` (`id` = `auth.users.id`, unique `username`, `focus_level`, `xp`, `focus_streak`), RLS policies, and a trigger that inserts a profile row on signup from username metadata.

If you already ran an older version of this file, re-run it so the `handle_new_user` trigger is installed.

Also enable **Email** auth under **Authentication → Providers**.

### 3b. Create the `friendships` table

In the Supabase SQL Editor, run:

[`supabase/friendships.sql`](supabase/friendships.sql)

Client helpers live in [`web/friends/friendsService.js`](web/friends/friendsService.js). Add Friend, Friend Requests, and the leaderboard use real accepted friendships from Supabase.

Public profile fields (`username`, `focus_level`, `xp`, `focus_streak`) are **read from Supabase** on website load (authoritative). Local storage is only a cache. Supabase is updated only when a real event changes stats (e.g. `recordCompletedSession`) — never by pushing stale local values on page load. Private session details stay local.

If your project still has a `focus_flame` column, run [`supabase/rename_focus_flame_to_streak.sql`](supabase/rename_focus_flame_to_streak.sql) once in the SQL Editor.

`profiles.xp` is **XP toward the next level** (with `focus_level`), not lifetime XP. If your rows still store legacy lifetime XP, run [`supabase/migrate_xp_to_progress.sql`](supabase/migrate_xp_to_progress.sql) once. Session XP rules live in [`web/profile/xp.js`](web/profile/xp.js) (15 XP/min + 25 on complete; `75 + 20L + 5L²` to level up).

To sync session summary cards (longest session, sessions completed, top distraction / productive site, character health), run [`supabase/add_session_summary_stats.sql`](supabase/add_session_summary_stats.sql) once.

### 4. Run the website

```bash
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`).

After sign-up / sign-in / page reload, the client loads the current user's `profiles` row from Supabase (authoritative for public stats) and keeps it in memory via `getCachedProfile()`.

## Session sync notes

`npm run build:extension` writes a loadable package to `dist/` (and `focus-buddy-extension.zip`).

When a focus timer completes, the extension:

1. Saves a completed session locally (`chrome.storage`)
2. Recalculates XP / Focus Level / Focus Streak with the same helpers as the website
3. Syncs only `xp`, `focus_level`, `focus_streak` to Supabase
4. If sync fails, keeps local progress and queues a retry (flushed on next auth init / completion)

Task text, site visits, and distraction logs stay local and are not uploaded.
