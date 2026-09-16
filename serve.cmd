@echo off
rem Parallax hero - Next.js dev server.
rem NOTE: this is a Next app, not static files. python -m http.server will NOT work.
cd /d "%~dp0"
call npx next dev -p 8792
