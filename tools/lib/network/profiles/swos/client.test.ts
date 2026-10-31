import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Client, digest, type Fetch } from "./client.ts";

describe("digest", () => {
  test("matches the example of RFC 2617", () => {
    const header = digest(
      {
        realm: "testrealm@host.com",
        nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093",
        qop: "auth",
        opaque: "5ccc069c403ebaf9f0171e9517f40e41",
      },
      {
        username: "Mufasa",
        password: "Circle Of Life",
        method: "GET",
        uri: "/dir/index.html",
        nc: 1,
        cnonce: "0a4f113b",
      },
    );
    assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
    assert.match(header, /nc=00000001/);
  });

  test("without a qop, the response leaves out the counters", () => {
    // RFC 2069
    const header = digest(
      { realm: "r", nonce: "n" },
      {
        username: "u",
        password: "",
        method: "GET",
        uri: "/x",
        nc: 1,
        cnonce: "c",
      },
    );
    assert.doesNotMatch(header, /cnonce|nc=/);
    assert.match(header, /response="[0-9a-f]{32}"/);
  });
});

const reply = (
  status: number,
  body = "",
  headers: Record<string, string> = {},
) => new Response(body, { status, headers });

describe("Client", () => {
  const challenge = (nonce: string) =>
    reply(401, "", {
      "www-authenticate": `Digest realm="switch", nonce="${nonce}", qop="auth"`,
    });

  test("answers the challenge, and then sends the answer up front", async () => {
    const seen: (string | undefined)[] = [];
    const fake: Fetch = async (_url, init) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      seen.push(auth);
      return auth ? reply(200, "{en:0x03}") : challenge("n1");
    };
    const client = new Client("http://sw", "admin", "", {
      fetch: fake,
      cnonce: () => "cn",
    });
    assert.deepEqual(await client.get("link"), { en: 3 });
    await client.get("fwd");
    assert.equal(seen.length, 3);
    assert.equal(seen[0], undefined);
    assert.match(seen[1]!, /nc=00000001/);
    assert.match(seen[2]!, /nc=00000002/);
  });

  test("answers a new challenge when the nonce goes stale", async () => {
    let nonce = "n1";
    const fake: Fetch = async (_url, init) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      return auth?.includes(`nonce="${nonce}"`)
        ? reply(200, "[]")
        : challenge(nonce);
    };
    const client = new Client("http://sw", "admin", "", { fetch: fake });
    await client.get("vlan");
    nonce = "n2";
    assert.deepEqual(await client.get("vlan"), []);
  });

  test("posts the encoded body as text", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const fake: Fetch = async (url, init) => {
      request = { url: String(url), init };
      return reply(200);
    };
    await new Client("http://sw", "admin", "", { fetch: fake }).post("sys", {
      id: "core",
    });
    assert.equal(request!.url, "http://sw/sys.b");
    assert.equal(request!.init!.method, "POST");
    assert.equal(request!.init!.body, "{id:'636f7265'}");
    assert.equal(
      (request!.init!.headers as Record<string, string>)["Content-Type"],
      "text/plain",
    );
  });

  test("fails with the status when the switch refuses", async () => {
    const fake: Fetch = async () => reply(500);
    await assert.rejects(
      new Client("http://sw", "admin", "", { fetch: fake }).get("link"),
      /GET \/link.b: HTTP 500/,
    );
  });

  test("a switch that wants basic auth is not digest", async () => {
    const fake: Fetch = async () =>
      reply(401, "", { "www-authenticate": 'Basic realm="x"' });
    await assert.rejects(
      new Client("http://sw", "admin", "", { fetch: fake }).get("link"),
      /not digest/,
    );
  });
});
