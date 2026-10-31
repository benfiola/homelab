export interface Subnet {
  cidr: string;
  network: string;
  prefix: number;
  // the address `n` above the network address
  host: (n: number) => string;
  // the first three octets of the network address, for ranges within its first /24
  base: string;
}

const octets = (address: string): number[] | undefined => {
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) {
    return undefined;
  }
  const numbers = parts.map(Number);
  return numbers.every((n) => n <= 255) ? numbers : undefined;
};

export const isAddress = (address: string) => octets(address) !== undefined;

const toNumber = (o: number[]) =>
  ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];

const toAddress = (n: number) =>
  [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

export const subnet = (cidr: string): Subnet => {
  const [address, length] = cidr.split("/");
  const parts = octets(address);
  const prefix = Number(length);
  if (!parts || !/^\d+$/.test(length ?? "") || prefix < 8 || prefix > 30) {
    throw new Error(`'${cidr}' is not a subnet (e.g. 192.168.8.0/24)`);
  }
  const network = toNumber(parts);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  if ((network & mask) >>> 0 !== network) {
    throw new Error(`'${cidr}' has host bits set`);
  }
  return {
    cidr,
    network: address,
    prefix,
    host: (n) => toAddress(network + n),
    base: parts.slice(0, 3).join("."),
  };
};

// whether an address is within a network given in cidr form (a bare address is a network of one)
export const contains = (cidr: string, address: string): boolean => {
  const [network, length] = cidr.split("/");
  const prefix = length === undefined ? 32 : Number(length);
  const n = octets(network);
  const a = octets(address);
  if (!n || !a || !(prefix >= 0 && prefix <= 32)) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (toNumber(n) & mask) >>> 0 === (toNumber(a) & mask) >>> 0;
};
