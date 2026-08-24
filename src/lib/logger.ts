type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

type LogContext = Record<string, unknown>;

function currentLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function write(level: LogLevel, message: string, context?: LogContext) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) {
    return;
  }

  const entry = {
    level,
    message,
    service: "youflicks",
    time: new Date().toISOString(),
    ...context,
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, context?: LogContext) {
    write("debug", message, context);
  },
  info(message: string, context?: LogContext) {
    write("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    write("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    write("error", message, context);
  },
  child(bindings: LogContext) {
    return {
      debug(message: string, context?: LogContext) {
        write("debug", message, { ...bindings, ...context });
      },
      info(message: string, context?: LogContext) {
        write("info", message, { ...bindings, ...context });
      },
      warn(message: string, context?: LogContext) {
        write("warn", message, { ...bindings, ...context });
      },
      error(message: string, context?: LogContext) {
        write("error", message, { ...bindings, ...context });
      },
    };
  },
};
