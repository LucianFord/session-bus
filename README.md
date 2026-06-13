# session-bus

> Cross-channel/session memory synchronization plugin for [OpenClaw](https://github.com/openclaw).

**session-bus** maintains a shared FIFO message queue so that conversations across different channels (WeChat, Discord, Telegram, web chat, etc.) can share situational context without polluting each session's own task focus.

---

## Table of Contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Tool / Hook reference](#tool--hook-reference)
- [Injected context format](#injected-context-format)
- [Local development](#local-development)
- [Contributing](#contributing)
- [License](#license)

---

## How it works

```
Channel A (Discord)          Channel B (WeChat)          Channel C (Telegram)
   session-A                    session-B                    session-C
       │                            │                            │
       │  message_received          │                            │
       ├──────────────────► shared queue (queue.jsonl)          │
       │                            │                            │
       │                            │  before_prompt_build       │
       │                            ◄────────────────────────────┤
       │                            │  inject foreign messages   │
       │                            │  (session-A's turns only)  │
```

1. Every inbound user message and outbound assistant reply is **appended** to a shared `queue.jsonl` file.
2. Each session has a **cursor** (stored in `cursors.json`) that tracks the last message it has seen.
3. Before each prompt is built, the plugin reads all queue entries since the cursor, filters to messages from *other* sessions, and **prepends** them as a brief context block so the model stays situationally aware.
4. The cursor is advanced after injection so messages are never re-delivered.
5. When the queue exceeds `maxQueueSize`, the oldest messages are evicted (FIFO).

---

## Installation

```bash
# From npm
npm install session-bus

# Or install directly from source
git clone https://github.com/LucianFord/session-bus.git
cd session-bus
npm install
npm run build
```

Then register the plugin in your OpenClaw configuration:

```jsonc
// ~/.openclaw/config.json
{
  "plugins": ["session-bus"]
}
```

If you installed from source, point to the local build:

```jsonc
{
  "plugins": ["/absolute/path/to/session-bus"]
}
```

---

## Configuration

Add a `session-bus` section under `pluginConfig` in your OpenClaw config:

```jsonc
{
  "plugins": ["session-bus"],
  "pluginConfig": {
    "session-bus": {
      "maxQueueSize": 200,
      "maxContentLength": 200,
      "storageDir": "session-bus"
    }
  }
}
```

| Option             | Type    | Default        | Description |
|--------------------|---------|----------------|-------------|
| `maxQueueSize`     | integer | `200`          | Maximum messages kept in the queue. Oldest entries are evicted when the limit is reached. Range: 1–10 000. |
| `maxContentLength` | integer | `200`          | Maximum character length per queued message. Longer messages are truncated before storage. Set to `0` to disable truncation. Range: 0–100 000. |
| `storageDir`       | string  | `"session-bus"` | Directory for `queue.jsonl` and `cursors.json`. The default resolves to `~/.openclaw/session-bus`. Relative paths are resolved against `~/.openclaw/`. Absolute paths are used as-is. |

---

## Architecture

```
session-bus/
├── index.ts              # Plugin entry point — wires config → registerHooks()
└── src/
    ├── types.ts          # ConfigSchema (TypeBox), ResolvedConfig, QueueMessage
    ├── queue.ts          # Append-only FIFO queue backed by queue.jsonl
    ├── cursor.ts         # Per-session read cursor backed by cursors.json
    ├── hooks.ts          # OpenClaw lifecycle hook registrations
    └── injector.ts       # Formats foreign messages into a prependContext block
```

### Storage layout

```
~/.openclaw/session-bus/
├── queue.jsonl     # One JSON-serialised QueueMessage per line
└── cursors.json    # { [sessionKey]: lastSeenMessageId | null }
```

`queue.jsonl` is **append-only** during normal operation. When the queue overflows `maxQueueSize`, the file is rewritten in-place with only the newest messages retained. Because OpenClaw is single-process, the JS event loop serialises all file operations — no external locking is needed.

### Data model

```ts
interface QueueMessage {
  id: string;           // UUID v4
  sessionKey: string;   // Canonical session identifier from OpenClaw
  source: "user" | "assistant";
  content: string;      // Possibly truncated to maxContentLength chars
  channel: string;      // channelId from PluginHookMessageContext
  timestamp: number;    // Unix milliseconds
}
```

---

## Tool / Hook reference

| Hook                  | Trigger                              | Action |
|-----------------------|--------------------------------------|--------|
| `session_start`       | New session created                  | Initialises a cursor at the current queue tail so the session only receives messages published *after* it started. |
| `message_received`    | Inbound user message                 | Appends a `source: "user"` entry to the queue. |
| `message_sent`        | Outbound assistant reply             | Appends a `source: "assistant"` entry. Skipped if `success === false` or `sessionKey` is unavailable (handled by `agent_end`). |
| `agent_end`           | Agent turn complete                  | Fallback for channels (e.g. web chat) that don't expose `sessionKey` in `message_sent`. Reads the last assistant message from the session transcript JSONL. Deduplicates against a 5-second window to avoid double-enqueuing. |
| `before_prompt_build` | Before prompt assembly               | Reads queue entries since the session's cursor, filters to foreign sessions, injects them as `prependContext`, and advances the cursor. |
| `after_compaction`    | Context window compacted             | Advances the cursor to the queue tail so stale message IDs from the pre-compaction transcript are never referenced again. |

---

## Injected context format

When foreign messages are available, the plugin prepends the following block to the prompt:

```
<!-- session-bus: cross-session context (for situational awareness; not part of the current task) -->
[2024-01-15T10:23:45.000Z] [channel:discord] [session:abc123] User: What's the weather in Tokyo?
[2024-01-15T10:23:46.500Z] [channel:discord] [session:abc123] Assistant: The weather in Tokyo is...
<!-- end session-bus context -->
```

The XML-style comment wrappers signal to the model that this is supplementary background context, not part of the active conversation.

---

## Local development

```bash
# Install dependencies
npm install

# Build (TypeScript → dist/)
npm run build

# Run tests (Vitest)
npm test

# Watch mode
npm run test:watch
```

### Running tests

The test suite uses [Vitest](https://vitest.dev/) and does **not** require a live OpenClaw instance. All file I/O is performed against temporary directories created per-test.

```
tests/
├── cursor.test.ts    # Cursor init/get/set, idempotency
├── hooks.test.ts     # Hook lifecycle integration
├── injector.test.ts  # Context formatting
└── queue.test.ts     # Append, trim, readSince, getTailId
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © LucianFord
