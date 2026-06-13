import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  append,
  readAll,
  readSince,
  trim,
  getTailId,
} from "../src/queue.js";
import type { QueueMessage } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "session-bus-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeMsg(overrides: Partial<QueueMessage> = {}): QueueMessage {
  return {
    id: crypto.randomUUID(),
    sessionKey: "test-session",
    source: "user",
    content: "hello",
    channel: "wechat",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readAll
// ---------------------------------------------------------------------------

describe("readAll", () => {
  it("returns empty array when file does not exist", async () => {
    expect(await readAll(dir)).toEqual([]);
  });

  it("returns all appended messages in order", async () => {
    const m1 = makeMsg({ content: "first" });
    const m2 = makeMsg({ content: "second" });
    await append(dir, m1, 500);
    await append(dir, m2, 500);
    const all = await readAll(dir);
    expect(all).toHaveLength(2);
    expect(all[0]!.content).toBe("first");
    expect(all[1]!.content).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe("append", () => {
  it("creates the storage directory if it does not exist", async () => {
    const subDir = join(dir, "sub", "bus");
    await append(subDir, makeMsg(), 500);
    const all = await readAll(subDir);
    expect(all).toHaveLength(1);
  });

  it("preserves all message fields", async () => {
    const msg = makeMsg({
      id: "fixed-id",
      sessionKey: "s1",
      source: "assistant",
      content: "reply",
      channel: "discord",
      timestamp: 1_700_000_000_000,
    });
    await append(dir, msg, 500);
    const [stored] = await readAll(dir);
    expect(stored).toEqual(msg);
  });

  it("evicts oldest messages when maxQueueSize is exceeded", async () => {
    const max = 3;
    for (let i = 0; i < 5; i++) {
      await append(dir, makeMsg({ content: `msg-${i}` }), max);
    }
    const all = await readAll(dir);
    expect(all).toHaveLength(max);
    expect(all[0]!.content).toBe("msg-2");
    expect(all[2]!.content).toBe("msg-4");
  });

  it("does not evict when queue is exactly at maxQueueSize", async () => {
    const max = 3;
    for (let i = 0; i < max; i++) {
      await append(dir, makeMsg({ content: `msg-${i}` }), max);
    }
    expect(await readAll(dir)).toHaveLength(max);
  });
});

// ---------------------------------------------------------------------------
// trim
// ---------------------------------------------------------------------------

describe("trim", () => {
  it("no-ops when queue is within limit", async () => {
    const msgs = [makeMsg({ content: "a" }), makeMsg({ content: "b" })];
    for (const m of msgs) await append(dir, m, 500);
    const result = await trim(dir, 500);
    expect(result).toHaveLength(2);
  });

  it("keeps only the newest N messages", async () => {
    for (let i = 0; i < 6; i++) await append(dir, makeMsg({ content: `m${i}` }), 500);
    const result = await trim(dir, 4);
    expect(result).toHaveLength(4);
    expect(result[0]!.content).toBe("m2");
    expect(result[3]!.content).toBe("m5");
  });

  it("persists the trimmed result so readAll reflects it", async () => {
    for (let i = 0; i < 5; i++) await append(dir, makeMsg({ content: `m${i}` }), 500);
    await trim(dir, 2);
    const all = await readAll(dir);
    expect(all).toHaveLength(2);
    expect(all[0]!.content).toBe("m3");
  });
});

// ---------------------------------------------------------------------------
// readSince
// ---------------------------------------------------------------------------

describe("readSince", () => {
  it("returns all messages when afterId is undefined", async () => {
    await append(dir, makeMsg({ content: "a" }), 500);
    await append(dir, makeMsg({ content: "b" }), 500);
    const { messages, cursorValid } = await readSince(dir, undefined);
    expect(messages).toHaveLength(2);
    expect(cursorValid).toBe(false);
  });

  it("returns messages after the given id", async () => {
    const m1 = makeMsg({ content: "first" });
    const m2 = makeMsg({ content: "second" });
    const m3 = makeMsg({ content: "third" });
    await append(dir, m1, 500);
    await append(dir, m2, 500);
    await append(dir, m3, 500);

    const { messages, cursorValid } = await readSince(dir, m1.id);
    expect(cursorValid).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe("second");
    expect(messages[1]!.content).toBe("third");
  });

  it("returns empty array when cursor points to the last message", async () => {
    const m = makeMsg();
    await append(dir, m, 500);
    const { messages, cursorValid } = await readSince(dir, m.id);
    expect(cursorValid).toBe(true);
    expect(messages).toHaveLength(0);
  });

  it("returns all messages and cursorValid=false when afterId is not found", async () => {
    await append(dir, makeMsg({ content: "x" }), 500);
    const { messages, cursorValid } = await readSince(dir, "nonexistent-id");
    expect(cursorValid).toBe(false);
    expect(messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getTailId
// ---------------------------------------------------------------------------

describe("getTailId", () => {
  it("returns undefined for an empty queue", async () => {
    expect(await getTailId(dir)).toBeUndefined();
  });

  it("returns the id of the last appended message", async () => {
    const m1 = makeMsg();
    const m2 = makeMsg();
    await append(dir, m1, 500);
    await append(dir, m2, 500);
    expect(await getTailId(dir)).toBe(m2.id);
  });
});
