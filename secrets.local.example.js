// Copy this file to secrets.local.js (gitignored) if you need a fresh template.
// Loaded by background.js via importScripts("secrets.local.js") under Manifest V3.
//
// Paste the SAME values as the website .env.local:
//   VITE_SUPABASE_URL              → self.SUPABASE_URL
//   VITE_SUPABASE_PUBLISHABLE_KEY  → self.SUPABASE_PUBLISHABLE_KEY
//
// NEVER put the secret / service-role key here.

self.GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";

self.SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
self.SUPABASE_PUBLISHABLE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";
