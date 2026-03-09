---
name: pair-programming
description: driver-to-navigator collaboration using the local pp cli (send messages, attach files, download artifacts).
---

# Pair Programming

Interact with the navigator using the local TypeScript `pp` CLI in this workspace.

- The driver (you) must collaborate with the navigator in back-and-forth loops.
- The driver writes code and runs tools; the navigator steers design.
- Requires either a CDP connection or a local Chromium profile/auth file with an active navigator session.

## Basic Message

`pp send "hello"`

## Quickstart

1. Write a prompt preamble to a temp file.
2. Run from your project root when using relative paths.
3. Pass entries directly as positional args to `pp compose`/`pp brief` (for shorthand slices, quote entries like `"src/main.rs:10-40"`).
4. Pick sync or async coordination mode before each navigator turn.
   - Sync mode: use default wait behavior from `pp send`/`pp brief`, set bash tool timeout very high (2+ hours if possible), let navigator finish.
   - Async mode: use `--no-wait`, continue local coding, then rejoin with `pp wait` or `pp get-response`.
   - If a wait call times out, run `pp wait` again and do not send another prompt until the current response is finished.

Example:

`pp brief --preamble-file /tmp/preamble.md crates/worker/src/lib.rs crates/worker/src/supervisor.rs`

## Codex Terminal Tool Calls

- Sync, one large yield (wait for process finish in one call):

```
"cmd": "pp brief --preamble-file /tmp/preamble.md crates/worker/src/lib.rs crates/worker/src/supervisor.rs",
"yield_time_ms": 7200000
```

- Sync with polling (if the initial wait times out)
- First call:

```
"cmd": "pp send \"navigator, review latest failing test and propose fix\"",
"yield_time_ms": 30000
```

- If the command returns a `session_id`, poll the same running process:

```
"session_id": 12345,
"chars": "",
"yield_time_ms": 30000
```

- Async fire-and-continue:

```
"cmd": "pp brief --no-wait --preamble-file /tmp/preamble.md src/index.ts",
"yield_time_ms": 1000
```

- Rejoin later for navigator output:

```
"cmd": "pp wait",
"yield_time_ms": 7200000
```

## Commands

`pp send` Send one message and wait for a response by default (`--file` accepts *one* file path).
`pp compose` Build a message from a preamble plus context entries.
`pp brief` Compose, send, and wait for a response by default (optional `--attach <path>` sends files/images with the brief; repeatable).
`pp attach` Attach files, text, or images (binary-safe; infers common MIME types). For image plus text in one command, use `pp attach <file> --prompt "..." --send --wait-for-response`.
`pp paste` Paste inline text.
`pp new` Start a fresh conversation.
`pp set-model` Set the mode (`auto` | `instant` | `thinking` | `pro`).
`pp wait` Wait for a response.
`pp get-response` Fetch the latest response.
`pp history` Show the transcript.
`pp refresh` Reload the UI.
`pp download` Download artifacts.

## Output

- Default output is text-first for response-returning flows (`pp send`, `pp brief`, `pp wait`, `pp get-response`).
- `pp download --list` prints `[index] file | path | label` lines.

## `<entries>` Formats

- Full file: `src/main.rs` or `file:src/main.rs`
- Line slice: `slice:path:start:end[:label]`
- Shorthand line slice: `path:start-end` or `path:start-end,start-end`

## Notes

- Write preamble content to files instead of inline shell.
- Entries like `path:10-40` can be passed directly as shorthand slices.
- Team coordination:
  - Sync: run one large yield and wait for the `pp` process to finish.
  - Async: run `pp ... --no-wait` and keep moving, then poll with `pp wait` or `pp get-response`.
  - Background terminal/process usage is valid in async mode.
- `pp --timeout` is in milliseconds (`7200000` = 2 hours).
- If compacting/summarizing context, always restore this skill or invoke the skill immediately again and continue the workflow loop (do not wait for confirmation/approval).
- Sessions have a char size limit; if it is hit and you are starting `pp new`, continue the workflow loop (do not wait for confirmation/approval).
- Ask about good commit breakpoints; committing progress is encouraged, but no upstream PRs/pushes.
- Always show your actual working files (entries); be honest and transparent, do not just summarize and pretend all is perfect.
- If you are getting stuck, complexity is rising, or tests are failing for an unclear reason, show it to the navigator and get advice.
