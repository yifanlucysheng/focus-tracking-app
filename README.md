# Focus Buddy

Chrome extension + standalone website for focus tracking.

## Website (Supabase auth)

The friends/account UI lives in `web/` and uses Vite so Supabase keys stay in env vars.

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

That creates `profiles` (`id` = `auth.users.id`, unique `username`, `focus_level`, `xp`, `focus_flame`), RLS policies, and a trigger that inserts a profile row on signup from username metadata.

If you already ran an older version of this file, re-run it so the `handle_new_user` trigger is installed.

Also enable **Email** auth under **Authentication → Providers**.

### 3b. Create the `friendships` table

In the Supabase SQL Editor, run:

[`supabase/friendships.sql`](supabase/friendships.sql)

Client helpers live in [`web/friends/friendsService.js`](web/friends/friendsService.js). Add Friend, Friend Requests, and the leaderboard use real accepted friendships from Supabase.

### 4. Run the website

```bash
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`).

After sign-up / sign-in / page reload, the client loads (and creates if missing) the current user's `profiles` row and keeps it in memory via `getCachedProfile()` for the rest of the app.
