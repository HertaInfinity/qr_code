# QR Attendance

Cloud-based attendance: the teacher's QR code rotates every 30 seconds, students scan it, and attendance appears live.

**Stack:** React + Material UI (Vite) · Flask + gunicorn (Docker) · Supabase (Auth, Postgres, Realtime) · Render

## Setup
1. **Supabase:** SQL Editor, run in order: `database/schema.sql`, `database/migration_01_accounts.sql`, `database/migration_02_classes.sql`.
   (Already ran the first two? Run only `migration_02_classes.sql`.)
2. **Supabase email:** set up custom SMTP, then edit Authentication -> Emails -> *Confirm signup* so the body contains `{{ .Token }}` (6-digit code).
3. **Frontend keys:** the public URL and publishable key are in `frontend/src/lib.js` (change them for a new project).
4. **Render:** Web Service from this repo, Runtime Docker, env vars `SUPABASE_URL` and `SUPABASE_KEY` (the service_role / secret key, server-side only).
5. Open `https://<service>.onrender.com/app`.

## Roles
Sign-up creates a student or teacher. Admins are set in SQL: `update public.profiles set role='admin' where id='<uuid>';`
Reset a student's device: `update public.profiles set device_id = null where id = '<uuid>';`

## Local frontend dev
`cd frontend && npm install && npm run build` (Flask serves the build from `/static`).

## To do
Resume session, forgot password, Google Sheets export, admin screen, teacher approval, join-code reset.
