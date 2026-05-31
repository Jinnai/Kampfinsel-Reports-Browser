# Kampfinsel Reports Browser

Web app for uploading, storing, and browsing Kampfinsel spy reports.

## Setup

1. Create a Supabase project.
2. Apply the SQL migration in `supabase/migrations/001_create_spy_reports.sql`.
3. Copy `.env.example` to `.env.local` and fill in the public project values.
4. Run the app:

```bash
npm install
npm run dev
```

## Environment

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Only use the Supabase anon key in the browser. Never put the service role key into the app, userscript, or loss calculator.
