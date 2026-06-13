/**
 * session-bus — OpenClaw plugin entry point.
 *
 * Cross-channel/session memory synchronisation via a shared FIFO message queue.
 */

import path from "node:path";
import { homedir } from "node:os";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { ConfigSchema, resolveConfig } from "./src/types.js";
import { registerHooks } from "./src/hooks.js";

export default definePluginEntry({
  id: "session-bus",
  name: "Session Bus",
  description:
    "Cross-channel/session memory synchronisation. Maintains a shared FIFO queue so conversations across different channels share context without polluting each session.",
  configSchema: ConfigSchema,
  register(api) {
    const cfg = resolveConfig(api.config);

    let storageDir = cfg.storageDir;

    // Resolve storageDir:
    // - Default (or "session-bus") → ~/.openclaw/session-bus
    // - Relative path → resolved against ~/.openclaw/
    // - Absolute path → used as-is
    // This keeps a strong default but still allows customization.
    if (!storageDir || storageDir === "session-bus") {
      storageDir = path.join(homedir(), ".openclaw", "session-bus");
    } else if (!storageDir.startsWith("/")) {
      storageDir = path.join(homedir(), ".openclaw", storageDir);
    }

    cfg.storageDir = storageDir;

    api.logger.info(
      `[session-bus] initialising — storageDir=${cfg.storageDir}, maxQueueSize=${cfg.maxQueueSize}`,
    );
    registerHooks(api, cfg);
  },
});
