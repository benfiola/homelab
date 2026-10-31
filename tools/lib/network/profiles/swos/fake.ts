import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hexEncode, parse } from "./protocol.ts";
import type { State } from "./config.ts";

// a switch to test against: digest auth, the .b endpoints, and writes that land in its state

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const evenHex = (n: number) => {
  const h = n.toString(16);
  return `0x${h.length % 2 ? "0" : ""}${h}`;
};

const serialize = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(serialize).join(",")}]`;
  if (typeof v === "number") return evenHex(v);
  if (typeof v === "string") return `'${v}'`; // already hex
  if (v && typeof v === "object") {
    return `{${Object.entries(v)
      .map(([k, x]) => `${k}:${serialize(x)}`)
      .join(",")}}`;
  }
  throw new Error(`cannot serialize ${v}`);
};

// a CSS318-16G-2S+: 18 ports (the last 2 sfp), factory defaults. strings are hex, as on the wire
export const factory = (): State => {
  const ports = 18;
  return {
    sys: { id: hexEncode("MikroTik"), ver: hexEncode("2.18") },
    link: {
      nm: Array.from({ length: ports }, (_, i) => hexEncode(`Port${i + 1}`)),
      en: 0x3ffff,
      an: 0x3ffff,
      fctc: 0x3ffff,
      fctr: 0x3ffff,
      sfpr: Array.from({ length: ports }, () => 0),
      sfp: 2,
      sfpo: 16,
      dpxc: 0x3ffff,
      spdc: Array.from({ length: ports }, () => 0),
    },
    fwd: {
      vlan: Array.from({ length: ports }, () => 1),
      vlni: Array.from({ length: ports }, () => 0),
      dvid: Array.from({ length: ports }, () => 1),
      fvid: 0,
    },
    vlan: [
      {
        vid: 1,
        mbr: 0x3ffff,
        nm: hexEncode("default"),
        igmp: 0,
        piso: 0,
        lrn: 1,
        mrr: 0,
      },
    ],
  };
};

export type FakeSwitch = {
  address: string;
  state: State;
  requests: string[];
  close: () => Promise<void>;
};

export const startSwitch = async (
  options: {
    username?: string;
    password?: string;
    state?: State;
    // endpoints that take a write and keep nothing
    ignore?: string[];
  } = {},
): Promise<FakeSwitch> => {
  const username = options.username ?? "admin";
  const password = options.password ?? "";
  const realm = "switch";
  const nonce = "0123456789abcdef";
  const fake = {
    state: options.state ?? factory(),
    requests: [] as string[],
  };

  const authorized = (method: string, header: string | undefined) => {
    if (!header?.startsWith("Digest ")) return false;
    const p: Record<string, string> = {};
    for (const [, k, quoted, bare] of header
      .slice(7)
      .matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
      p[k] = quoted ?? bare;
    }
    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${method}:${p.uri}`);
    const expected = md5(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:auth:${ha2}`);
    return (
      p.username === username && p.nonce === nonce && p.response === expected
    );
  };

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const method = req.method!;
      if (!authorized(method, req.headers.authorization)) {
        res.writeHead(401, {
          "www-authenticate": `Digest realm="${realm}", nonce="${nonce}", qop="auth"`,
        });
        return res.end();
      }
      fake.requests.push(`${method} ${req.url}`);
      const endpoint = req.url?.match(/^\/(\w+)\.b$/)?.[1] as
        keyof State | undefined;
      if (!endpoint || !(endpoint in fake.state)) {
        res.writeHead(404);
        return res.end();
      }
      if (method === "POST") {
        const written = parse(body);
        if (!options.ignore?.includes(endpoint)) {
          const current = fake.state[endpoint];
          fake.state[endpoint] = (
            Array.isArray(written)
              ? written
              : { ...current, ...(written as object) }
          ) as never;
        }
        res.writeHead(200);
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(serialize(fake.state[endpoint]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(fake, {
    address: `127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
};
