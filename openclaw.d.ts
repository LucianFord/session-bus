declare module "openclaw/plugin-sdk/core" {
  export interface PluginLogger {
    debug?: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  }

  export interface HookContext {
    sessionKey?: string;
    sessionId?: string;
    conversationId?: string;
    channelId?: string;
    [key: string]: unknown;
  }

  export interface MessageEvent {
    content?: string;
    timestamp?: number;
    success?: boolean;
    [key: string]: unknown;
  }

  export interface OpenClawPluginApi {
    id: string;
    name: string;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  }

  export function definePluginEntry(entry: {
    id: string;
    name: string;
    description?: string;
    configSchema?: unknown;
    register(api: OpenClawPluginApi): void | Promise<void>;
  }): unknown;
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  export { definePluginEntry } from "openclaw/plugin-sdk/core";
}
