import { contains } from "./ip.ts";

export interface WireguardClient {
  privateKey: string;
  // the client's address on the wireguard network
  address: string;
  // the server's public key for that network
  publicKey: string;
  // the server's port for that network
  port: number;
  allowedIps: string[];
}

// the configuration a device imports into its wireguard client. the router is the resolver of
// the clients that can reach it.
export const wireguardConfig = (
  client: WireguardClient,
  server: { endpoint: string; resolver: string },
): string =>
  [
    "[Interface]",
    `PrivateKey = ${client.privateKey}`,
    `Address = ${client.address}`,
    ...(client.allowedIps.some((ip) => contains(ip, server.resolver))
      ? [`DNS = ${server.resolver}`]
      : []),
    "",
    "[Peer]",
    `PublicKey = ${client.publicKey}`,
    `Endpoint = ${server.endpoint}:${client.port}`,
    `AllowedIPs = ${client.allowedIps.join(", ")}`,
  ].join("\n");
