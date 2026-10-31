// the wire format of MikroTik SwOS (the full firmware, not SwOS Lite): javascript object
// literals with bare hex numbers and hex-encoded strings, in both directions.

// SwOS answers with non-json: bare 0x hex numbers, unquoted keys, single-quoted strings
export const parse = (text: string): unknown => {
  let s = text.trim();
  // numbers first: strings are hex digits, so they never contain "0x"
  s = s.replace(/0x([0-9a-fA-F]+)/g, (_, h) => parseInt(h, 16).toString());
  s = s.replace(/([{,[]\s*)([a-zA-Z_!][a-zA-Z0-9_!]*)(\s*:)/g, '$1"$2"$3');
  s = s.replace(/'([^']*)'/g, '"$1"');
  return JSON.parse(s);
};

export const hexEncode = (s: string): string =>
  Buffer.from(s, "utf8").toString("hex");

export const hexDecode = (s: string): string =>
  Buffer.from(s, "hex").toString("utf8");

// 511 -> 0x01ff: SwOS wants whole bytes
const evenHex = (n: number): string => {
  const h = n.toString(16);
  return `0x${h.length % 2 ? "0" : ""}${h}`;
};

const value = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(value).join(",")}]`;
  if (typeof v === "number") return evenHex(v);
  if (typeof v === "string") return `'${hexEncode(v)}'`;
  throw new Error(`cannot encode a ${typeof v} for SwOS`);
};

type Fields = Record<string, unknown>;

// the body of a POST: strings are encoded, numbers are hex. an array of objects is a table
export const encode = (data: Fields | Fields[]): string => {
  const object = (o: Fields) =>
    `{${Object.entries(o)
      .map(([k, v]) => `${k}:${value(v)}`)
      .join(",")}}`;
  return Array.isArray(data) ? `[${data.map(object).join(",")}]` : object(data);
};

// ports are bits in a number: port 1 is bit 0. (bitwise operators are 32 bits wide)
export const maxPorts = 32;

export const toMask = (ports: number[]): number =>
  ports.reduce((mask, p) => (mask | (1 << (p - 1))) >>> 0, 0);

export const fromMask = (mask: number, ports: number): number[] =>
  Array.from({ length: ports }, (_, i) => i + 1).filter((p) =>
    hasBit(mask, p - 1),
  );

export const hasBit = (mask: number, bit: number): boolean =>
  ((mask >>> bit) & 1) === 1;

export const withBit = (mask: number, bit: number, on: boolean): number =>
  (on ? mask | (1 << bit) : mask & ~(1 << bit)) >>> 0;
