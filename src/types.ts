import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Queue message — one entry in the shared FIFO bus
// ---------------------------------------------------------------------------

export interface QueueMessage {
  /** UUID v4 */
  id: string;
  /**
   * Identifies the session that produced this message.
   * Always use the canonical ctx.sessionKey when available; do not fall back
   * to conversationId/channelId because that can produce duplicate or stale
   * cross-session context after gateway restarts.
   */
  sessionKey: string;
  source: "user" | "assistant";
  content: string;
  /** channelId from PluginHookMessageContext */
  channel: string;
  /** Unix ms timestamp */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Plugin configuration schema (TypeBox)
// ---------------------------------------------------------------------------

export const ConfigSchema = Type.Object(
  {
    maxQueueSize: Type.Optional(
      Type.Integer({
        default: 200,
        minimum: 1,
        maximum: 10_000,
        description:
          "Maximum number of messages kept in the shared queue (oldest evicted). Default: 200.",
      }),
    ),
    maxContentLength: Type.Optional(
      Type.Integer({
        default: 200,
        minimum: 0,
        maximum: 100_000,
        description:
          "Maximum content length per queued message. Default: 200. Set to 0 to disable truncation.",
      }),
    ),
    storageDir: Type.Optional(
      Type.String({
        default: "session-bus",
        description:
          "Directory for queue.jsonl and cursors.json. Default: ~/.openclaw/session-bus. " +
          "If the value is a relative path, it is resolved relative to ~/.openclaw/. " +
          "Absolute paths are used as-is. This allows customization while keeping a good default.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type Config = Static<typeof ConfigSchema>;

/** Resolved config with all defaults applied */
export interface ResolvedConfig {
  maxQueueSize: number;
  maxContentLength: number;
  storageDir: string;
}

export function resolveConfig(raw: unknown): ResolvedConfig {
  const cfg = (raw ?? {}) as Partial<Config>;
  return {
    maxQueueSize: cfg.maxQueueSize ?? 200,
    maxContentLength: cfg.maxContentLength ?? 200,
    storageDir: cfg.storageDir ?? "session-bus",
  };
}
