import { describe, it, expect } from "vitest";
import { buildInjectedContext } from "../src/injector.js";
import type { QueueMessage } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(overrides: Partial<QueueMessage> = {}): QueueMessage {
  return {
    id: crypto.randomUUID(),
    sessionKey: "session-a",
    source: "user",
    content: "hello",
    channel: "wechat",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildInjectedContext
// ---------------------------------------------------------------------------

describe("buildInjectedContext", () => {
  it("returns null for an empty message list", () => {
    expect(buildInjectedContext([], "session-a")).toBeNull();
  });

  it("returns null when all messages belong to the current session", () => {
    const msgs = [
      makeMsg({ sessionKey: "session-a", content: "msg1" }),
      makeMsg({ sessionKey: "session-a", content: "msg2" }),
    ];
    expect(buildInjectedContext(msgs, "session-a")).toBeNull();
  });

  it("returns a non-null string when at least one foreign message exists", () => {
    const msgs = [
      makeMsg({ sessionKey: "session-a" }),
      makeMsg({ sessionKey: "session-b", content: "foreign" }),
    ];
    const result = buildInjectedContext(msgs, "session-a");
    expect(result).not.toBeNull();
  });

  it("only includes messages from other sessions", () => {
    const msgs = [
      makeMsg({ sessionKey: "session-a", content: "own-msg" }),
      makeMsg({ sessionKey: "session-b", content: "foreign-msg" }),
    ];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).not.toContain("own-msg");
    expect(result).toContain("foreign-msg");
  });

  it("wraps output in HTML comment markers", () => {
    const msgs = [makeMsg({ sessionKey: "session-b", content: "hi" })];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).toContain("<!-- session-bus:");
    expect(result).toContain("<!-- end session-bus context -->");
  });

  it("includes ISO timestamp in each line", () => {
    const ts = 1_700_000_000_000;
    const msgs = [makeMsg({ sessionKey: "session-b", timestamp: ts })];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).toContain(new Date(ts).toISOString());
  });

  it("includes channel in each line", () => {
    const msgs = [makeMsg({ sessionKey: "session-b", channel: "discord" })];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).toContain("[channel:discord]");
  });

  it("includes sessionKey in each line", () => {
    const msgs = [makeMsg({ sessionKey: "session-xyz", channel: "telegram" })];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).toContain("[session:session-xyz]");
  });

  it("labels user messages as 'User'", () => {
    const msgs = [makeMsg({ sessionKey: "session-b", source: "user", content: "hey" })];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).toContain("User: hey");
  });

  it("labels assistant messages as 'Assistant'", () => {
    const msgs = [
      makeMsg({ sessionKey: "session-b", source: "assistant", content: "sure thing" }),
    ];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).toContain("Assistant: sure thing");
  });

  it("preserves message order in the output", () => {
    const msgs = [
      makeMsg({ sessionKey: "session-b", content: "first", timestamp: 1_000 }),
      makeMsg({ sessionKey: "session-b", content: "second", timestamp: 2_000 }),
      makeMsg({ sessionKey: "session-b", content: "third", timestamp: 3_000 }),
    ];
    const result = buildInjectedContext(msgs, "session-a")!;
    const firstIdx = result.indexOf("first");
    const secondIdx = result.indexOf("second");
    const thirdIdx = result.indexOf("third");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it("handles messages from multiple foreign sessions in the same output", () => {
    const msgs = [
      makeMsg({ sessionKey: "session-b", content: "from-b" }),
      makeMsg({ sessionKey: "session-c", content: "from-c" }),
    ];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).toContain("from-b");
    expect(result).toContain("from-c");
    expect(result).toContain("[session:session-b]");
    expect(result).toContain("[session:session-c]");
  });

  it("mixes own and foreign messages — skips own, includes foreign", () => {
    const msgs = [
      makeMsg({ sessionKey: "session-a", content: "mine-1" }),
      makeMsg({ sessionKey: "session-b", content: "theirs-1" }),
      makeMsg({ sessionKey: "session-a", content: "mine-2" }),
      makeMsg({ sessionKey: "session-c", content: "theirs-2" }),
    ];
    const result = buildInjectedContext(msgs, "session-a")!;
    expect(result).not.toContain("mine-1");
    expect(result).not.toContain("mine-2");
    expect(result).toContain("theirs-1");
    expect(result).toContain("theirs-2");
  });
});
