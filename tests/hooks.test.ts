import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "../src/hooks.js";
import { readAll } from "../src/queue.js";
import { resolveConfig } from "../src/types.js";

function makeApi(storageDir: string) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const api: any = {
    logger: {
      debug: () => {},
      warn: () => {},
    },
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    },
  };
  return { api, handlers, storageDir };
}

describe("registerHooks", () => {
  it("does not queue message_sent when sessionKey is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "session-bus-hooks-"));
    const { handlers } = makeApi(dir);
    registerHooks(
      {
        logger: { debug: () => {}, warn: () => {} },
        on: (event: string, handler: (...args: any[]) => any) => {
          handlers.set(event, handler);
        },
      } as any,
      { ...resolveConfig({}), storageDir: dir, maxQueueSize: 500, maxContentLength: 500 },
    );

    const handler = handlers.get("message_sent")!;
    await handler(
      {
        success: true,
        content: "assistant reply",
      },
      {
        conversationId: "raw-wechat-account-id",
        channelId: "openclaw-weixin",
      },
    );

    expect(await readAll(dir)).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("truncates queued message content by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "session-bus-hooks-"));
    const { handlers } = makeApi(dir);
    registerHooks(
      { logger: { debug: () => {}, warn: () => {} }, on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler) } as any,
      { ...resolveConfig({}), storageDir: dir },
    );

    const handler = handlers.get("message_received")!;
    await handler(
      { content: "a".repeat(300) },
      { sessionKey: "s1", channelId: "webchat" },
    );

    const [msg] = await readAll(dir);
    expect(msg?.content).toHaveLength(200);
    expect(msg?.content).toBe("a".repeat(200));
    await rm(dir, { recursive: true, force: true });
  });

  it("does not truncate queued message content when maxContentLength is 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "session-bus-hooks-"));
    const { handlers } = makeApi(dir);
    registerHooks(
      { logger: { debug: () => {}, warn: () => {} }, on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler) } as any,
      { ...resolveConfig({}), storageDir: dir, maxContentLength: 0 },
    );

    const handler = handlers.get("message_received")!;
    const content = "a".repeat(300);
    await handler({ content }, { sessionKey: "s1", channelId: "webchat" });

    const [msg] = await readAll(dir);
    expect(msg?.content).toBe(content);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("resolveConfig", () => {
  it("uses the new queue and content defaults", () => {
    expect(resolveConfig({})).toMatchObject({ maxQueueSize: 200, maxContentLength: 200 });
  });
});
