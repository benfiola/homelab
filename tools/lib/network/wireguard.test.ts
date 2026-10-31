import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wireguardConfig } from "./wireguard.ts";

const server = { endpoint: "wireguard.example.test", resolver: "192.168.88.1" };

const client = {
  privateKey: "PRIVATE",
  address: "192.168.41.3/32",
  publicKey: "PUBLIC",
  port: 13235,
  allowedIps: ["192.168.33.7/32"],
};

describe("wireguardConfig", () => {
  test("describes the client and the server it connects to", () => {
    assert.equal(
      wireguardConfig(client, server),
      [
        "[Interface]",
        "PrivateKey = PRIVATE",
        "Address = 192.168.41.3/32",
        "",
        "[Peer]",
        "PublicKey = PUBLIC",
        "Endpoint = wireguard.example.test:13235",
        "AllowedIPs = 192.168.33.7/32",
      ].join("\n"),
    );
  });

  test("lists every allowed ip", () => {
    assert.match(
      wireguardConfig(
        {
          ...client,
          allowedIps: ["10.0.0.0/24", "10.0.1.0/24"],
        },
        server,
      ),
      /AllowedIPs = 10\.0\.0\.0\/24, 10\.0\.1\.0\/24$/,
    );
  });

  test("clients that can reach the router use it as their resolver", () => {
    assert.match(
      wireguardConfig(
        {
          ...client,
          allowedIps: ["192.168.32.0/23", "192.168.88.1/32"],
        },
        server,
      ),
      /Address = [^\n]*\nDNS = 192\.168\.88\.1\n/,
    );
    assert.match(
      wireguardConfig({ ...client, allowedIps: ["192.168.88.0/24"] }, server),
      /\nDNS = 192\.168\.88\.1\n/,
    );
  });

  test("other clients get no resolver", () => {
    assert.doesNotMatch(wireguardConfig(client, server), /DNS/);
  });
});
