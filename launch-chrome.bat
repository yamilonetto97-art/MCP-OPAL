@echo off
echo Launching Chrome with remote debugging...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%APPDATA%\opal-mcp\temp-profile" --no-first-run https://opal.google/
echo Chrome launched! Sign in to Google, then run: npx tsx src/auth/grab-cookies.ts
