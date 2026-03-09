# PP

## What?

- TypeScript CLI workspace around Playwright and ChatGPT automation.
- Binary is `pp`.
- Runtime truth lives in `src/navigator/*`.
- Behavior locks live in `tests/navigator/*.test.mjs`.

## Start Fast

- From the repo root, enter the shell with `devenv shell`.
- Run all unit tests with `npm test`.
- Run navigator-only tests with `npm run test:navigator`.

## State + Profile Model

- State root is `${XDG_STATE_HOME:-$HOME/.local/state}/pp`
- Important dirs:
- `${state_root}/profiles`
- `${state_root}/auth`
- `${state_root}/runtime`
- Project binding defaults from env via `PP_CHATGPT_PROJECT`.
- Profile binding defaults from env via `PP_PROFILE`.
- Browser binding defaults from env via `PP_BROWSER` (`chromium` or `firefox`).
- Per-command flags override env (`--project`, `--profile`, `--browser`).

## Session/Auth Modes

- `--cdp-url` attach mode
- `--profile` managed profile mode
- `--user-data-dir` explicit profile path mode
- `--auth-file` `storageState` bootstrap mode

## Browser Profile

- Logical profile root is `${state_root}/profiles/<profile>`.
- Browser user-data is partitioned by runtime:
- `${state_root}/profiles/<profile>/browser-state/v1/linux`
- `${state_root}/profiles/<profile>/browser-state/v1/darwin`
- `${state_root}/profiles/<profile>/browser-state/v1/windows`
- Firefox partitions are prefixed (`firefox-linux`, `firefox-darwin`, `firefox-windows`).
- WSL plus Windows-host browser uses the `windows` suffix (`windows` for Chromium, `firefox-windows` for Firefox).

## WSL/Windows

- When launching Windows Chromium from WSL, `user-data-dir` is converted to Windows path syntax before launch.
- `/mnt/<drive>/...` becomes `<DRIVE>:\\...`
- Other Linux paths become `\\\\wsl.localhost\\<distro>\\...`
- `WSL_DISTRO_NAME` must exist for UNC conversion path building.
