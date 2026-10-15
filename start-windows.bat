@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   Ewan Hospital - Clean Test App v0.7
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 or newer first.
  pause
  exit /b 1
)
node -e "const fs=require('fs');const p=process.env.DATA_DIR||'data';const f=require('path').join(p,'db.json');try{const d=JSON.parse(fs.readFileSync(f,'utf8'));process.exit(d.users&&d.users.some(u=>u.role==='admin')?0:1)}catch{process.exit(1)}"
if errorlevel 1 (
  echo No admin account found. Create the first administrator now.
  echo Run: npm run create-admin
  pause
  exit /b 1
)
echo Opening server at http://localhost:3000
echo Press Ctrl+C to stop the server.
start "" http://localhost:3000
node server.js
pause
