/**
 * Register all session-bus hooks against the OpenClaw plugin API.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as readline from "node:readline";
import type { OpenClawPluginApi, HookContext, MessageEvent } from "openclaw/plugin-sdk/core";
import type { ResolvedConfig } from "./types.js";
import { append, getTailId, readAll, readSince } from "./queue.js";
import { getCursor, initCursor, setCursor } from "./cursor.js";
import { buildInjectedContext } from "./injector.js";
import { sanitizeChannel, sanitizeContent } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stream sessions.json to find the sessionId for a given sessionKey
 * without loading the entire file (can be 2MB+) into memory.
 */
function findSessionIdInSessions(sessionKey: string, sessionsDir: string): Promise<string | undefined> {
  const sessionsJsonPath = nodePath.join(sessionsDir, "sessions.json");
  const escapedKey = JSON.stringify(sessionKey);
  const SCAN_WINDOW = 512;

  return new Promise((resolve) => {
    let tail = "";
    let resolved = false;
    const stream = fs.createReadStream(sessionsJsonPath, { encoding: "utf8", highWaterMark: 65536 });

    stream.on("data", (chunk: string | Buffer) => {
      if (resolved) return;
      const buf = tail + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      const keyIdx = buf.indexOf(escapedKey);
      if (keyIdx !== -1) {
        const window = buf.slice(keyIdx, keyIdx + escapedKey.length + SCAN_WINDOW);
        const m = window.match(/"sessionId"\s*:\s*"([^"]+)"/);
        if (m?.[1]) { resolved = true; resolve(m[1]); stream.destroy(); return; }
        tail = buf.slice(keyIdx);
      } else {
        tail = buf.length > SCAN_WINDOW ? buf.slice(buf.length - SCAN_WINDOW) : buf;
      }
    });

    stream.on("close", () => { if (!resolved) resolve(undefined); });
    stream.on("error", () => resolve(undefined));
  });
}

/**
 * Stream a JSONL transcript and return the text of the last assistant message.
 * Line format: { type: "message", message: { role: "assistant", content: [{ type: "text", text: "..." }] } }
 */
function readLastAssistantFromTranscript(transcriptPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let lastText: string | undefined;
    const stream = fs.createReadStream(transcriptPath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry["type"] === "message") {
          const msg = entry["message"] as Record<string, unknown> | undefined;
          if (msg?.["role"] === "assistant") {
            const content = msg["content"] as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(content) && content[0]?.["type"] === "text") {
              lastText = content[0]["text"] as string | undefined;
            }
          }
        }
      } catch { /* skip malformed lines */ }
    });

    rl.on("close", () => resolve(lastText));
    stream.on("error", () => resolve(undefined));
  });
}

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

function truncateContent(content: string, maxContentLength: number): string {
  if (maxContentLength <= 0) return content;
  return content.length > maxContentLength
    ? content.slice(0, maxContentLength)
    : content;
}

export function registerHooks(api: OpenClawPluginApi, cfg: ResolvedConfig): void {
  const { storageDir, maxQueueSize, maxContentLength } = cfg;

  // session_start — init cursor at queue tail so the session only receives
  // messages produced *after* it was created.
  api.on("session_start", async (_event, ctx) => {
    const c = ctx as HookContext;
    const sessionKey = c.sessionKey;
    if (!sessionKey) return;
    try {
      const tailId = await getTailId(storageDir);
      await initCursor(storageDir, sessionKey, tailId);
    } catch (err) {
      api.logger.warn(`[session-bus] session_start error for ${sessionKey}: ${String(err)}`);
    }
  });

  // message_received — enqueue inbound user message.
  api.on("message_received", async (event, ctx) => {
    const c = ctx as HookContext;
    const ev = event as MessageEvent;
    const sessionKey = c.sessionKey;
    if (!sessionKey) return;
    try {
      await append(storageDir, {
        id: crypto.randomUUID(),
        sessionKey,
        source: "user",
        content: sanitizeContent(truncateContent(ev.content ?? "(no content)", maxContentLength), { maxLength: 0 }),
        channel: sanitizeChannel(c.channelId ?? "unknown"),
        timestamp: ev.timestamp ?? Date.now(),
      }, maxQueueSize);
    } catch (err) {
      api.logger.warn(`[session-bus] message_received error: ${String(err)}`);
    }
  });

  // message_sent — enqueue outbound assistant message.
  // sessionKey is optional in this context; Discord provides it, webchat/yuanbao do not.
  // Missing sessionKey → skip (agent_end handles those channels).
  api.on("message_sent", async (event, ctx) => {
    const ev = event as MessageEvent;
    if (ev.success === false) return;
    const c = ctx as HookContext;
    const sessionKey = c.sessionKey;
    if (!sessionKey) return;
    try {
      await append(storageDir, {
        id: crypto.randomUUID(),
        sessionKey,
        source: "assistant",
        content: sanitizeContent(truncateContent(ev.content ?? "(no content)", maxContentLength), { maxLength: 0 }),
        channel: sanitizeChannel(c.channelId ?? "unknown"),
        timestamp: Date.now(),
      }, maxQueueSize);
    } catch (err) {
      api.logger.warn(`[session-bus] message_sent error: ${String(err)}`);
    }
  });

  // agent_end — fallback to enqueue assistant messages for channels that
  // don't provide sessionKey in message_sent (webchat, yuanbao).
  // Reads the last assistant message directly from the session transcript JSONL.
  // Dedup: skips if message_sent already enqueued for this session within 5s.
  api.on("agent_end", async (event, ctx) => {
    const c = ctx as HookContext;
    const sessionKey = c.sessionKey;
    if (!sessionKey) return;
    const ev = event as Record<string, unknown>;
    if (ev.success === false) return;

    // Dedup check
    try {
      const all = await readAll(storageDir);
      const lastForSession = [...all].reverse().find((m) => m.sessionKey === sessionKey);
      if (lastForSession?.source === "assistant" && Date.now() - lastForSession.timestamp < 5000) {
        return;
      }
    } catch { /* proceed on read failure */ }

    const sessionsDir = nodePath.join(os.homedir(), ".openclaw", "agents", "main", "sessions");
    let content: string | undefined;
    try {
      const uuid = await findSessionIdInSessions(sessionKey, sessionsDir);
      if (!uuid) return;
      content = await readLastAssistantFromTranscript(nodePath.join(sessionsDir, `${uuid}.jsonl`));
    } catch (err) {
      api.logger.warn(`[session-bus] agent_end transcript error for ${sessionKey}: ${String(err)}`);
      return;
    }

    if (!content) return;

    try {
      await append(storageDir, {
        id: crypto.randomUUID(),
        sessionKey,
        source: "assistant",
        content: sanitizeContent(truncateContent(content, maxContentLength), { maxLength: 0 }),
        channel: sanitizeChannel(c.channelId ?? "unknown"),
        timestamp: Date.now(),
      }, maxQueueSize);
    } catch (err) {
      api.logger.warn(`[session-bus] agent_end error for ${sessionKey}: ${String(err)}`);
    }
  });

  // before_prompt_build — read queue from cursor, inject foreign messages
  // (other sessions only) as prependContext, advance cursor.
  api.on("before_prompt_build", async (_event, ctx) => {
    const c = ctx as HookContext;
    const sessionKey = c.sessionKey;
    if (!sessionKey) return;

    try {
      const cursorId = await getCursor(storageDir, sessionKey);

      // First time seeing this session — init cursor at tail, don't inject history.
      if (cursorId === undefined) {
        const tailId = await getTailId(storageDir);
        await initCursor(storageDir, sessionKey, tailId);
        return;
      }

      const { messages } = await readSince(storageDir, cursorId ?? undefined);

      // Only inject messages from *other* sessions to avoid duplicating
      // history that OpenClaw already tracks in the transcript.
      const foreignMessages = messages.filter((m) => m.sessionKey !== sessionKey);

      // Always advance cursor so we never re-read the same messages.
      if (messages.length > 0) {
        await setCursor(storageDir, sessionKey, messages[messages.length - 1]!.id);
      }

      const context = buildInjectedContext(foreignMessages, sessionKey);
      if (context) return { prependContext: context };
    } catch (err) {
      api.logger.warn(`[session-bus] before_prompt_build error for ${sessionKey}: ${String(err)}`);
    }
  });

  // after_compaction — advance cursor past compacted messages so it stays valid.
  api.on("after_compaction", async (_event, ctx) => {
    const c = ctx as HookContext;
    const sessionKey = c.sessionKey;
    if (!sessionKey) return;
    try {
      const tailId = await getTailId(storageDir);
      if (tailId !== undefined) {
        await setCursor(storageDir, sessionKey, tailId);
      }
    } catch (err) {
      api.logger.warn(`[session-bus] after_compaction error for ${sessionKey}: ${String(err)}`);
    }
  });

  // session_end — flush session context to daily log before the session is gone.
  // This handles idle timeout, daily reset, manual /new, compaction, etc.
  api.on("session_end", async (event, ctx) => {
    const c = ctx as HookContext;
    const sessionKey = c.sessionKey;
    if (!sessionKey) return;

    try {
      // Read all messages for this session from the queue
      const all = await readAll(storageDir);
      const sessionMessages = all.filter((m) => m.sessionKey === sessionKey);

      if (sessionMessages.length === 0) return;

      // Build a compact summary of the session
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toISOString().slice(11, 16);

      // Get last few messages (both user and assistant) for context
      const recentMessages = sessionMessages.slice(-20).map((m) => {
        const ts = new Date(m.timestamp);
        const h = ts.getHours().toString().padStart(2, "0");
        const min = ts.getMinutes().toString().padStart(2, "0");
        const role = m.source === "user" ? "User" : "Assistant";
        return `[${h}:${min}] [${role}] ${m.content.slice(0, 200)}`;
      });

      const reason = (event as Record<string, unknown>).reason ?? "unknown";
      const summary = [
        `## ${timeStr} — Session 结束 (reason: ${reason})`,
        "",
        `Session: ${sessionKey}`,
        `消息数: ${sessionMessages.length}`,
        "",
        "### 最近对话",
        ...recentMessages.map((m) => `- ${m}`),
        "",
      ].join("\n");

      // Write to daily log
      const workspaceDir = process.env["OPENCLAW_WORKSPACE_DIR"]
        || nodePath.join(os.homedir(), ".openclaw", "workspace");
      const memoryDir = nodePath.join(workspaceDir, "memory");

      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
      }

      const dailyLog = nodePath.join(memoryDir, `${dateStr}.md`);
      fs.appendFileSync(dailyLog, summary, "utf8");

      api.logger.info(`[session-bus] session_end flush: ${sessionKey} (${sessionMessages.length} msgs) → ${dailyLog}`);
    } catch (err) {
      api.logger.warn(`[session-bus] session_end flush error for ${sessionKey}: ${String(err)}`);
    }
  });
}
