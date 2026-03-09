# PP Auth Exporter Extension

Chrome extension that exports cookies to the local `pp` auth listener.

## Load Extension

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Click load unpacked.
4. Select `extension/auth-exporter`.

## Run Listener

```bash
devenv shell bash -lc '
npm run build
node dist/cli.js auth-listen
'
```

Listener output includes:

- WebSocket URL (default `ws://127.0.0.1:9271/`)
- One-time token
- Target auth directory

## Export Cookies

1. Open the extension popup.
2. Paste the token from `auth-listen`.
3. Add/select domains (the current tab hostname is prefilled).
4. Click export cookies.

Saved files are Playwright storage state JSON files:

- `<auth-dir>/<domain_with_underscores>.json`

Example:

- `~/.config/pp/auth/chatgpt_com.json`

## Use Exported Auth State

You can pass exported auth directly to navigator commands:

```bash
devenv shell bash -lc '
CHROMIUM_BIN=$(command -v chromium)
node dist/cli.js send \
  --chromium-bin "$CHROMIUM_BIN" \
  --auth-file ~/.config/pp/auth/chatgpt_com.json \
  "Reply with AUTH_OK"
'
```
