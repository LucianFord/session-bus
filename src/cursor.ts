/**
 * Cursor management.
 *
 * The cursors file is a simple JSON object:
 *   { [sessionKey: string]: string | null }
 *
 * A value of null means "session has been initialised but there were no
 * messages in the queue at start time — deliver everything from the head".
 * A non-null string is the id of the last message this session has already
 * seen (exclusive upper bound for the next delivery).
 *
 * Layout:
 *   <storageDir>/cursors.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

type CursorMap = Record<string, string | null>;

function cursorsPath(storageDir: string): string {
  return join(storageDir, "cursors.json");
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function readMap(storageDir: string): Promise<CursorMap> {
  const path = cursorsPath(storageDir);
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as CursorMap;
  } catch {
    return {};
  }
}

async function writeMap(storageDir: string, map: CursorMap): Promise<void> {
  await ensureDir(storageDir);
  await writeFile(cursorsPath(storageDir), JSON.stringify(map, null, 2), "utf8");
}

/**
 * Get the cursor for a session.
 * Returns undefined if the session has never been registered.
 * Returns null if the session was registered but no tail existed at that time.
 * Returns a string (message id) for normal cursors.
 */
export async function getCursor(
  storageDir: string,
  sessionKey: string,
): Promise<string | null | undefined> {
  const map = await readMap(storageDir);
  if (!(sessionKey in map)) return undefined;
  return map[sessionKey] ?? null;
}

/**
 * Set (or update) the cursor for a session.
 * Pass null to indicate "session started but queue was empty".
 */
export async function setCursor(
  storageDir: string,
  sessionKey: string,
  messageId: string | null,
): Promise<void> {
  const map = await readMap(storageDir);
  map[sessionKey] = messageId;
  await writeMap(storageDir, map);
}

/**
 * Initialise the cursor for a new session to the current queue tail.
 * If the session already has a cursor this is a no-op (idempotent).
 * Returns the cursor value that was set.
 */
export async function initCursor(
  storageDir: string,
  sessionKey: string,
  tailId: string | undefined,
): Promise<string | null> {
  const existing = await getCursor(storageDir, sessionKey);
  if (existing !== undefined) return existing;

  const value = tailId ?? null;
  await setCursor(storageDir, sessionKey, value);
  return value;
}
