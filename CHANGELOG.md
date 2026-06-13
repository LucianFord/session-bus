# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-01-15

### Added

- **Shared FIFO message queue** backed by an append-only `queue.jsonl` file.  
  Supports `append`, `readAll`, `readSince`, `trim`, and `getTailId` operations.
- **Per-session cursor tracking** via `cursors.json`.  
  Each session maintains an exclusive read cursor so it only receives messages published after it started (or after the last delivery).
- **`session_start` hook** — initialises the cursor at the current queue tail for new sessions.
- **`message_received` hook** — enqueues inbound user messages.
- **`message_sent` hook** — enqueues outbound assistant replies for channels that expose `sessionKey` (e.g. Discord).
- **`agent_end` hook** — fallback enqueue path for channels that do not expose `sessionKey` in `message_sent` (e.g. web chat, Yuanbao). Reads the last assistant message from the session transcript JSONL and deduplicates against a 5-second window.
- **`before_prompt_build` hook** — injects messages from foreign sessions as a `prependContext` block and advances the cursor.
- **`after_compaction` hook** — advances the cursor to the queue tail after context-window compaction to prevent stale cursor references.
- **`maxQueueSize` config option** (default: 200) — oldest messages evicted when the limit is reached.
- **`maxContentLength` config option** (default: 200) — per-message content truncation; set to 0 to disable.
- **`storageDir` config option** (default: `~/.openclaw/session-bus`) — supports relative (resolved against `~/.openclaw/`) and absolute paths.
- TypeBox config schema with full validation and defaults.
- 46 unit tests covering queue, cursor, injector, and hook lifecycle logic.

[0.1.0]: https://github.com/LucianFord/session-bus/releases/tag/v0.1.0
