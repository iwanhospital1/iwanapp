# Ewan Hospital — v0.7 Clean Test Build

Arabic RTL, mobile-first PWA prototype for internal workflow testing.

## What changed in v0.7
- Removed all built-in demo accounts and seeded demo doctors, appointments, and pharmacy inventory.
- Fresh database starts empty. The first administrator is created locally by `npm run create-admin`.
- Added admin-only full JSON backup download and restore screen.
- Restore validates the backup format and requires that it contain the currently signed-in admin; restore replaces the current database.
- Updated PWA cache version so browsers do not keep the old UI.
- Added clean-start smoke tests.

## Local Windows start
1. Install Node.js 20 or newer.
2. Extract this ZIP into a **new folder**, for example `C:\EwanHospital-v07`. Do not reuse the old project's folder if you want to retain it as a fallback.
3. Open Command Prompt in this folder.
4. Run `npm run create-admin`, and follow the prompts. Choose a unique admin username and a strong password (10+ characters).
5. Run `start-windows.bat` and open `http://localhost:3000`.
6. Register test patient/doctor/staff accounts through the app; they stay pending until the administrator approves them.

## Backups
- Sign in as admin → **النسخ الاحتياطي** → **تنزيل نسخة احتياطية كاملة**.
- Store the JSON file in a secure, encrypted location outside the repository and outside the public website.
- To restore: admin → **النسخ الاحتياطي** → choose the previous JSON file → confirm.
- Restore replaces current data. Make a fresh backup first. Backup files include personal data and password hashes; never commit them to GitHub or send them to anyone.
- The application data file `data/db.json` is ignored by Git.

## GitHub (source code only)
1. Create a **Private** repository on GitHub.
2. Confirm `data/db.json`, `.env`, any backup `.json`, and credentials are not selected for upload. `.gitignore` excludes the local database and environment files.
3. In a terminal in the project folder:
   ```bash
   git init
   git add .
   git status
   ```
4. Inspect `git status` and verify no database, backup, `.env`, password, API key, or patient data is staged.
5. Commit and connect the private repository:
   ```bash
   git commit -m "Prepare Ewan Hospital clean test build"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-PRIVATE-REPO.git
   git push -u origin main
   ```
   Replace the repository URL with your own. Never paste a personal access token into source files.

## Supabase status — read before using
**This v0.7 build is not connected to Supabase yet.** It still stores data in the local JSON file. Creating a Supabase project or uploading this repository does not move the app data into Supabase. The existing `database/schema.sql` is a draft and should not be treated as a complete production migration.

You may create a Supabase project for the next integration phase:
1. Open https://supabase.com/dashboard and create a project in an appropriate region.
2. Use a unique database password and store it in a password manager. Do not commit it to GitHub or share it in chat.
3. Wait for the project to finish provisioning.
4. In **Project Settings → API**, note the Project URL and publishable/anon key for the future integration. Do not place the `service_role`/secret key in browser code or commit it.
5. Do not import real patient information or expose the current JSON-backed prototype publicly. Next, the app must be migrated to Supabase Postgres, Supabase Auth or secure server-side auth, private Storage buckets, and Row Level Security policies, then tested with synthetic data.

## Important safety limitations
- This is a development/test prototype, not a clinical production system.
- Do not use real patient data until database hosting, authentication, authorization, file storage, audit logs, encrypted backups, HTTPS, recovery, and privacy/security review are complete.
- Online payment is still a test simulation. The meeting link uses a public test room and is not suitable for confidential sessions.
- The local JSON store is not suitable for multiple instances or concurrent production use.


## First local sign-in (v0.7.1 repair bundle)

This ZIP contains one local bootstrap administrator so the local app can be opened immediately.
- Username: `ewanadmin`
- Temporary password: `EwanStart2026!`

Change this password immediately after sign-in and do not reuse it elsewhere. The local `data/db.json` is excluded from Git by `.gitignore`; do not commit it. The app is still a local JSON prototype and is **not connected to Supabase yet**. Uploading this repository to GitHub does not deploy a working cloud backend.

For a future empty installation, `npm run create-admin` now uses Node's readline API and writes atomically to the same `DATA_DIR` used by the server.
