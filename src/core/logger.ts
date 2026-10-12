/**
 * Minimal structured logger. Never log phone numbers, tokens, passwords or message
 * bodies — log IDs instead.
 */

type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? order.info;

function emit(level: Level, message: string, data?: Record<string, unknown>) {
  if (order[level] < threshold) return;
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => emit("debug", message, data),
  info: (message: string, data?: Record<string, unknown>) => emit("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => emit("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => emit("error", message, data),
};

/** Extract a safe error description for logs. */
export function errorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { error: error.message, name: error.name };
  return { error: String(error) };
}
