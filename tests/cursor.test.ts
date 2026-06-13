import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCursor, setCursor, initCursor } from "../src/cursor.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "session-bus-cursor-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getCursor
// ---------------------------------------------------------------------------

describe("getCursor", () => {
  it("returns undefined for a session that has never been registered", async () => {
    const result = await getCursor(dir, "unknown-session");
    expect(result).toBeUndefined();
  });

  it("returns null when the session was registered with no tail (empty queue)", async () => {
    await setCursor(dir, "s1", null);
    const result = await getCursor(dir, "s1");
    expect(result).toBeNull();
  });

  it("returns the message id that was set", async () => {
    await setCursor(dir, "s2", "msg-abc-123");
    const result = await getCursor(dir, "s2");
    expect(result).toBe("msg-abc-123");
  });

  it("returns undefined for one session while another has a cursor", async () => {
    await setCursor(dir, "s1", "some-id");
    const result = await getCursor(dir, "s2");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setCursor
// ---------------------------------------------------------------------------

describe("setCursor", () => {
  it("creates the storage directory if needed", async () => {
    const subDir = join(dir, "nested", "bus");
    await setCursor(subDir, "s1", "id-1");
    expect(await getCursor(subDir, "s1")).toBe("id-1");
  });

  it("overwrites an existing cursor with a new value", async () => {
    await setCursor(dir, "s1", "id-first");
    await setCursor(dir, "s1", "id-second");
    expect(await getCursor(dir, "s1")).toBe("id-second");
  });

  it("can update a cursor from a string back to null", async () => {
    await setCursor(dir, "s1", "some-id");
    await setCursor(dir, "s1", null);
    expect(await getCursor(dir, "s1")).toBeNull();
  });

  it("multiple sessions are stored independently", async () => {
    await setCursor(dir, "alice", "id-a");
    await setCursor(dir, "bob", "id-b");
    await setCursor(dir, "charlie", null);

    expect(await getCursor(dir, "alice")).toBe("id-a");
    expect(await getCursor(dir, "bob")).toBe("id-b");
    expect(await getCursor(dir, "charlie")).toBeNull();
  });

  it("persists across separate getCursor calls (reads from disk)", async () => {
    await setCursor(dir, "s1", "persistent-id");
    // Simulate a fresh read by calling getCursor in a new invocation
    const result = await getCursor(dir, "s1");
    expect(result).toBe("persistent-id");
  });
});

// ---------------------------------------------------------------------------
// initCursor
// ---------------------------------------------------------------------------

describe("initCursor", () => {
  it("sets cursor to tailId when session is new", async () => {
    const value = await initCursor(dir, "s1", "tail-id-xyz");
    expect(value).toBe("tail-id-xyz");
    expect(await getCursor(dir, "s1")).toBe("tail-id-xyz");
  });

  it("sets cursor to null when tailId is undefined (empty queue)", async () => {
    const value = await initCursor(dir, "s1", undefined);
    expect(value).toBeNull();
    expect(await getCursor(dir, "s1")).toBeNull();
  });

  it("does not overwrite an existing string cursor (idempotent)", async () => {
    await setCursor(dir, "s1", "original-id");
    const value = await initCursor(dir, "s1", "new-tail-id");
    expect(value).toBe("original-id");
    expect(await getCursor(dir, "s1")).toBe("original-id");
  });

  it("does not overwrite an existing null cursor (idempotent)", async () => {
    await setCursor(dir, "s1", null);
    const value = await initCursor(dir, "s1", "new-tail-id");
    expect(value).toBeNull();
    expect(await getCursor(dir, "s1")).toBeNull();
  });

  it("initialises different sessions independently", async () => {
    await initCursor(dir, "s1", "tail-a");
    await initCursor(dir, "s2", "tail-b");
    await initCursor(dir, "s3", undefined);

    expect(await getCursor(dir, "s1")).toBe("tail-a");
    expect(await getCursor(dir, "s2")).toBe("tail-b");
    expect(await getCursor(dir, "s3")).toBeNull();
  });
});
