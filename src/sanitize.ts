import { createHash } from "node:crypto";

export interface SanitizeOptions {
  /** Maximum length after sanitization. 0 means no truncation. */
  maxLength?: number;
}

const SENSITIVE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "session-bus-context",
    pattern: /<!--\s*session-bus:.*?-->/gis,
  },
  {
    name: "authorization-header",
    pattern: /\bauthorization\s*:\s*[^\r\n,;]+/gi,
  },
  {
    name: "cookie-header",
    pattern: /\bcookie\s*:\s*[^\r\n]+/gi,
  },
  {
    name: "cookie-pair",
    pattern: /\b(?:abrequestid|xsecappid|a1|webid|gid)\s*=\s*[^\s;&]+/gi,
  },
  {
    name: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: "openrouter-token",
    pattern: /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "openai-token",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "credential-assignment",
    pattern: /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*[^\s,;]+/gi,
  },
  {
    name: "email",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  },
  {
    name: "mainland-phone",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  },
  {
    name: "linux-home-path",
    pattern: /\/home\/[A-Za-z0-9_.-]+/g,
  },
  {
    name: "windows-user-path",
    pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+/g,
  },
];

export function sanitizeContent(content: string, options: SanitizeOptions = {}): string {
  let sanitized = content;
  for (const item of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(item.pattern, `[redacted ${item.name}]`);
  }

  const maxLength = options.maxLength ?? content.length;
  if (maxLength > 0 && sanitized.length > maxLength) {
    return sanitized.slice(0, maxLength);
  }
  return sanitized;
}

export function hashSessionKey(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 10);
}

export function sanitizeChannel(channel: string): string {
  const sanitized = sanitizeContent(channel, { maxLength: 80 });
  if (!sanitized || sanitized.includes("[redacted")) return "redacted-channel";
  if (/[A-Za-z0-9_-]{20,}@|@im\.|user:\d{10,}/.test(sanitized)) return "redacted-channel";
  return sanitized;
}
