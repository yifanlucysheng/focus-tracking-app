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

In the Supabase SQL Editor, run:

[`supabase/profiles.sql`](supabase/profiles.sql)

Also enable **Email** auth under **Authentication → Providers**.

### 4. Run the website

```bash
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`).

Sign up creates an `auth.users` row and a matching `profiles` row (`id` = auth user id).
Friendships are not implemented yet — the leaderboard still uses mock data.
