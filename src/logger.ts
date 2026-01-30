import pino from "pino";

export const logLevels = {
  trace: 10,
  debug: 20,
  info: 30,
  status: 35,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export type LogLevels = typeof logLevels;
export type LogLevel = keyof LogLevels;
export type LogLevelLabel = LogLevels[LogLevel];

export const logLabels: Record<LogLevelLabel, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  35: "status",
  40: "warn",
  50: "error",
  60: "fatal",
};

export type LogStatus = "work" | "success" | "failure";

type Logger = pino.Logger<LogLevel>;

let _logger: Logger | null = null;

export const logger = () => {
  if (_logger === null) {
    throw new Error(`logger not set`);
  }
  return _logger;
};

export const setLogger = (logger: Logger) => {
  _logger = logger;
};
