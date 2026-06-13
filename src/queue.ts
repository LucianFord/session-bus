/**
 * Append-only FIFO message queue backed by a JSONL file.
 *
 * Layout:
 *   <storageDir>/queue.jsonl  — one JSON-serialised QueueMessage per line
 *
 * Because OpenClaw is single-process the file operations are serialised by the
 * JS event loop; no external locking is required.
 */

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { QueueMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

function queuePath(storageDir: string): string {
  return join(storageDir, "queue.jsonl");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read all messages currently in the queue file.
 * Returns an empty array if the file does not yet exist.
 */
export async function readAll(storageDir: string): Promise<QueueMessage[]> {
  const path = queuePath(storageDir);
  if (!existsSync(path)) return [];

  const raw = await readFile(path, "utf8");
  const messages: QueueMessage[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as QueueMessage);
    } catch {
      // Skip malformed lines — prefer resilience over hard failure
    }
  }

  return messages;
}

/**
 * Read messages that come *after* (not including) the message with `afterId`.
 * If `afterId` is undefined or not found in the queue, all messages are returned
 * (treating it as "cursor points to nothing valid → start from beginning").
 */
export async function readSince(
  storageDir: string,
  afterId: string | undefined,
): Promise<{ messages: QueueMessage[]; cursorValid: boolean }> {
  const all = await readAll(storageDir);

  if (afterId === undefined) {
    return { messages: all, cursorValid: false };
  }

  const idx = all.findIndex((m) => m.id === afterId);
  if (idx === -1) {
    // Cursor points to an evicted message — return everything from head
    return { messages: all, cursorValid: false };
  }

  return { messages: all.slice(idx + 1), cursorValid: true };
}

/**
 * Append a single message to the queue file, then trim the queue to
 * `maxQueueSize` by rewriting the file when it exceeds the limit.
 *
 * Returns the (potentially trimmed) full list of messages after the write.
 */
export async function append(
  storageDir: string,
  message: QueueMessage,
  maxQueueSize: number,
): Promise<QueueMessage[]> {
  await ensureDir(storageDir);

  const path = queuePath(storageDir);
  const line = JSON.stringify(message) + "\n";
  await appendFile(path, line, "utf8");

  // Check whether trim is needed without re-reading when unnecessary
  const all = await readAll(storageDir);
  if (all.length > maxQueueSize) {
    return trim(storageDir, maxQueueSize);
  }

  return all;
}

/**
 * Trim the queue to `maxSize` by evicting the oldest messages.
 * Rewrites queue.jsonl in-place.
 * Returns the messages that remain after trimming.
 */
export async function trim(
  storageDir: string,
  maxSize: number,
): Promise<QueueMessage[]> {
  const all = await readAll(storageDir);
  if (all.length <= maxSize) return all;

  const kept = all.slice(all.length - maxSize);
  await ensureDir(storageDir);
  await writeFile(
    queuePath(storageDir),
    kept.map((m) => JSON.stringify(m)).join("\n") + "\n",
    "utf8",
  );
  return kept;
}

/**
 * Return the id of the last message in the queue, or undefined if empty.
 * Used by session_start to initialise a cursor at the current tail so new
 * sessions only receive messages added after they were created.
 */
export async function getTailId(
  storageDir: string,
): Promise<string | undefined> {
  const all = await readAll(storageDir);
  return all.length > 0 ? all[all.length - 1]!.id : undefined;
}
