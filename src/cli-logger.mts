import { once } from "events";
import build from "pino-abstract-transport";
import { SonicBoom } from "sonic-boom";
import {
  logLabels,
  LogLevel,
  LogLevelLabel,
  logLevels,
  LogStatus,
} from "./logger";

export type LogFormat = "raw" | "plain" | "rich";

export interface TransportOpts {
  format: LogFormat;
}

type Formatter = (data: Record<string, any>) => string;

const rawFormatter: Formatter = (data) => {
  const message = JSON.stringify(data);
  return message;
};

const plainFormatter: Formatter = (data) => {
  const message = data?.msg;
  if (typeof message !== "string") {
    throw new Error(`unexpected msg field in log payload: ${data}`);
  }
  return message;
};

const colors = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[37m",
  status: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
  reset: "\x1b[0m",
};

const richFormatter: Formatter = (data) => {
  const level: LogLevelLabel = data.level;

  let icon: string;
  let label: LogLevel;
  if (level === logLevels.status) {
    label = "status";
    const status: LogStatus = data.status;
    if (status === "failure") {
      icon = "✗";
    } else if (status === "success") {
      icon = "✓";
    } else if (status === "work") {
      icon = "*";
    } else {
      icon = "???";
    }
  } else {
    label = logLabels[level];
    icon = label[0].toUpperCase();
  }

  const color = colors[label];

  const msg = data?.msg;
  if (typeof msg !== "string") {
    throw new Error(`invalid msg field: ${data}`);
  }

  const message = `${color}${icon} ${msg}${colors.reset}`;
  return message;
};

const formatters: Record<LogFormat, Formatter> = {
  plain: plainFormatter,
  raw: rawFormatter,
  rich: richFormatter,
};

export default async function (opts: TransportOpts) {
  const formatter = formatters[opts.format];
  if (!formatter) {
    throw new Error(`invalid format '${opts.format}'`);
  }

  const destination = new SonicBoom({
    dest: 2,
    sync: true,
  });

  await once(destination, "ready");

  return build(
    async (source) => {
      for await (let data of source) {
        const formatted = formatter(data);
        const written = destination.write(`${formatted}\n`);
        if (!written) {
          await once(destination, "drain");
        }
      }
    },
    {
      close: async () => {
        destination.end();
        await once(destination, "close");
      },
    }
  );
}
