/**
 * Context injection logic.
 *
 * Builds the prependContext string that is returned from the
 * before_prompt_build hook so the model is aware of cross-session activity.
 */

import type { QueueMessage } from "./types.js";
import { hashSessionKey, sanitizeContent } from "./sanitize.js";

/**
 * Filter the messages that came after the cursor and that belong to a
 * *different* session from the current one, then format them for injection.
 *
 * @param messages   All messages returned by readSince (already filtered to
 *                   start after the cursor)
 * @param currentSessionKey  The sessionKey of the session currently building a prompt
 * @returns Formatted context string, or null if there is nothing to inject
 */
export function buildInjectedContext(
  messages: QueueMessage[],
  currentSessionKey: string,
): string | null {
  const foreign = messages.filter((m) => m.sessionKey !== currentSessionKey);
  if (foreign.length === 0) return null;

  const lines: string[] = [
    "<!-- session-bus: cross-session context (for situational awareness; not part of the current task) -->",
  ];

  for (const msg of foreign) {
    const ts = new Date(msg.timestamp).toISOString();
    const role = msg.source === "user" ? "User" : "Assistant";
    const sessionLabel = hashSessionKey(msg.sessionKey);
    const content = sanitizeContent(msg.content, { maxLength: 0 });
    lines.push(
      `[${ts}] [channel:${msg.channel}] [session:#${sessionLabel}] ${role}: ${content}`,
    );
  }

  lines.push("<!-- end session-bus context -->");
  return lines.join("\n");
}
