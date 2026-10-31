import { createHash, randomBytes } from "node:crypto";
import { encode, parse } from "./protocol.ts";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

type Challenge = {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
};

const challenge = (header: string): Challenge => {
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "digest") {
    throw new Error(
      `the switch asked for '${scheme}' authentication, not digest`,
    );
  }
  const params: Record<string, string> = {};
  for (const [, key, quoted, bare] of rest
    .join(" ")
    .matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
    params[key] = quoted ?? bare;
  }
  if (!params.realm || !params.nonce) {
    throw new Error(`incomplete digest challenge: ${header}`);
  }
  // "auth,auth-int" is a list of what the server accepts
  const qop = params.qop
    ?.split(",")
    .map((q) => q.trim())
    .find((q) => q === "auth");
  return {
    realm: params.realm,
    nonce: params.nonce,
    qop,
    opaque: params.opaque,
  };
};

// RFC 2617 / 7616 digest (md5, qop=auth): what SwOS speaks. exported to be tested against the RFC
export const digest = (
  c: Challenge,
  o: {
    username: string;
    password: string;
    method: string;
    uri: string;
    nc: number;
    cnonce: string;
  },
): string => {
  const ha1 = md5(`${o.username}:${c.realm}:${o.password}`);
  const ha2 = md5(`${o.method}:${o.uri}`);
  const nc = o.nc.toString(16).padStart(8, "0");
  const response = c.qop
    ? md5(`${ha1}:${c.nonce}:${nc}:${o.cnonce}:${c.qop}:${ha2}`)
    : md5(`${ha1}:${c.nonce}:${ha2}`);
  const fields = [
    `username="${o.username}"`,
    `realm="${c.realm}"`,
    `nonce="${c.nonce}"`,
    `uri="${o.uri}"`,
    ...(c.qop ? [`qop=${c.qop}`, `nc=${nc}`, `cnonce="${o.cnonce}"`] : []),
    `response="${response}"`,
    ...(c.opaque ? [`opaque="${c.opaque}"`] : []),
  ];
  return `Digest ${fields.join(", ")}`;
};

export type Fetch = typeof fetch;

export class Client {
  private url: string;
  private username: string;
  private password: string;
  private fetch: Fetch;
  private cnonce: () => string;
  private challenge?: Challenge;
  private nc = 0;

  constructor(
    url: string,
    username: string,
    password: string,
    options: { fetch?: Fetch; cnonce?: () => string } = {},
  ) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.cnonce = options.cnonce ?? (() => randomBytes(8).toString("hex"));
  }

  private async send(
    method: string,
    path: string,
    body?: string,
  ): Promise<Response> {
    const request = (c?: Challenge) => {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["Content-Type"] = "text/plain";
      if (c) {
        headers.Authorization = digest(c, {
          username: this.username,
          password: this.password,
          method,
          uri: path,
          nc: ++this.nc,
          cnonce: this.cnonce(),
        });
      }
      return this.fetch(`${this.url}${path}`, { method, headers, body });
    };

    let response = await request(this.challenge);
    if (response.status === 401) {
      // the first request has no challenge to answer; later ones have a stale nonce
      this.challenge = challenge(
        response.headers.get("www-authenticate") ?? "",
      );
      this.nc = 0;
      response = await request(this.challenge);
    }
    return response;
  }

  async get(endpoint: string): Promise<unknown> {
    const path = `/${endpoint}.b`;
    const response = await this.send("GET", path);
    if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
    return parse(await response.text());
  }

  async post(
    endpoint: string,
    data: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<void> {
    const path = `/${endpoint}.b`;
    const response = await this.send("POST", path, encode(data));
    if (!response.ok) throw new Error(`POST ${path}: HTTP ${response.status}`);
  }
}
