# MikroTik SwOS HTTP API

Reference for reimplementing `swos.ts`. All protocol details were
reverse-engineered from [python-mikrotik-swos](https://github.com/lanrat/python-mikrotik-swos)
and [PR #4](https://github.com/lanrat/python-mikrotik-swos/pull/4) (CSS318/CSS326 support).

---

## Platform variants

SwOS ships in two firmware flavours. **They use completely different field names
and must not be mixed.**

| Variant | Field style | Example key | Models |
|---|---|---|---|
| **SwOS** (full) | Descriptive | `en`, `nm`, `vlan` | CRS*, RB*, CSS318, CSS326 |
| **SwOS Lite** | Hex-ID | `i01`, `i0a`, `i15` | Most CSS* (older) |

**`src/swos.ts` implements SwOS (full) only.** The CSS318-16G-2S+ and
CSS326-24G-2S+ run full SwOS despite the `CSS` prefix. The authoritative signal
is the field names in the `sys.b` response: descriptive names → SwOS full;
`i01`/`i07` style → SwOS Lite.

---

## Authentication

SwOS uses **HTTP Digest authentication** (RFC 7616, MD5 variant).

1. Client sends an unauthenticated request.
2. Switch responds `HTTP 401` with:
   ```
   WWW-Authenticate: Digest realm="...", nonce="...", qop="auth"
   ```
3. Client computes:
   ```
   HA1      = MD5(username + ":" + realm + ":" + password)
   HA2      = MD5(method + ":" + request-uri)
   response = MD5(HA1 + ":" + nonce + ":" + nc + ":" + cnonce + ":" + qop + ":" + HA2)
   ```
4. Client resends with:
   ```
   Authorization: Digest username="...", realm="...", nonce="...", uri="...",
                         qop=auth, nc=00000001, cnonce="...", response="..."
   ```

The default admin account has **no password** (empty string). HTTP Digest is
still used — just with `password = ""`.

---

## Wire format

### GET requests

```
GET /{endpoint}.b HTTP/1.1
```

The response body is a **JavaScript object literal**, not valid JSON. It uses:
- **Bare hex integers**: `0x01ff`, `0x00`, `0x3ff`
- **Unquoted keys**: `{en:0x01ff,nm:[...]}`
- **Single-quoted hex strings**: `'506f727431'` (ASCII bytes of "Port1")
- **Arrays**: `[0x02,0x00,0x01]` or `['hex1','hex2']`
- **Array of objects**: `[{vid:0x08,mbr:0x01ff,...},{...}]`

Parse algorithm (same as python-mikrotik-swos `parse_js_object`):
1. Replace `0x([0-9a-fA-F]+)` with decimal integer — **must happen first**,
   before quote replacement, so hex inside strings isn't touched.
2. Quote unquoted object keys: `{en:...}` → `{"en":...}`
3. Replace single-quoted strings with double-quoted: `'abc'` → `"abc"`
4. `JSON.parse()`

After parsing, values are:
- Hex scalars → JavaScript numbers
- Hex strings → JavaScript strings containing hex bytes (still encoded)

### POST requests

```
POST /{endpoint}.b HTTP/1.1
Content-Type: text/plain

{key:value,key:[val,val,...]}
```

Value encoding rules:
- **Numbers/bitmasks** → even-length hex: `0` → `0x00`, `511` → `0x01ff`
- **Strings** → hex-encoded UTF-8 wrapped in single quotes: `"Port1"` → `'506f727431'`
- **Arrays of numbers** → `[0x02,0x00,0x01]`  (same even-hex rule per element)
- **Arrays of strings** → `['506f727431','506f727432']`

**Only send writable fields** — including read-only status fields in a POST
body may cause errors or be silently ignored. See per-endpoint tables below.

For endpoints whose response is an **array of objects** (e.g. `vlan.b`), the
POST body is also an array: `[{...},{...}]`.

---

## String encoding

SwOS stores text (port names, switch identity, VLAN names, etc.) as
**hex-encoded UTF-8** with no `0x` prefix:

```
"Port1"      →  "506f727431"
"core.switch" →  "636f72652e7377697463"
```

Decode: `Buffer.from(hex, "hex").toString("utf8")`  
Encode: `Buffer.from(str, "utf8").toString("hex")`

---

## Port bitmasks

Many fields represent a set of ports as a bitmask:
- **Bit 0 = port 1**, bit 1 = port 2, …, bit N-1 = port N
- CSS318 has 18 ports → bitmask fits in a 32-bit int
- Example: ports {1, 3, 18} → `(1<<0)|(1<<2)|(1<<17)` = `0x020005`

---

## Endpoints (SwOS full firmware)

### `sys.b` — System info

**GET response** (object):

| Field | Type | Description |
|---|---|---|
| `id` | hex-string | Switch identity (hostname) |
| `ver` | hex-string | Firmware version |
| `brd` | hex-string | Model string (e.g. `CSS318-16G-2S+`) |
| `mac` | hex-string | Base MAC address |
| `sid` | hex-string | Serial number |
| `upt` | number | Uptime |
| `cip` | mixed | IP configuration |
| `aci` | mixed | Management ACL config |
| `temp` | number | Temperature (°C × 10) |
| `fan1`/`fan2` | number | Fan speeds |

**POST** (writable fields only):

| Field | Description |
|---|---|
| `id` | Switch identity |
| `cip` | IP configuration |
| `aci` | Management ACL |

SwOS accepts partial POSTs — you can send just `{id:'...'}` to change
only the identity.

> **`cip` — IP configuration (not yet implemented)**: The `cip` field encodes
> the switch's own IP address, netmask, gateway, and DHCP/static mode. The
> exact binary layout of this field is undocumented and would need to be
> reverse-engineered by reading a live switch in both DHCP and static modes.
> Until implemented, the switch IP must be configured via the web UI or DHCP
> reservation. The `address` used by `apply-swos`/`dump-swos` is always a CLI
> argument, never stored in the config file.

---

### `link.b` — Port link state and names

**GET response** (object with per-port arrays):

| Field | Type | Description |
|---|---|---|
| `en` | bitmask | Enabled ports |
| `an` | bitmask | Auto-negotiation enabled ports |
| `nm` | string[] | Port names (hex-encoded, one per port) |
| `fctc` | bitmask | TX flow control enabled ports (writable config) |
| `fctr` | bitmask | RX flow control enabled ports (writable config) |
| `sfpr` | number[] | SFP rate select, one entry per port (0/1). Only meaningful for the ports in the SFP range (see `sfp`/`sfpo`) |
| `sfp` | number | Number of SFP ports (read-only) |
| `sfpo` | number | 0-based index of the first SFP port (read-only) |
| `lnk` | bitmask | Link up (read-only) |
| `dpx` | bitmask | Full duplex, currently observed (read-only) |
| `dpxc` | bitmask | Duplex config — only meaningful when `an` is off for that port (not exposed — unconfirmed semantics) |
| `spd` | number[] | Speed, currently observed/negotiated, one entry per port (read-only) |
| `spdc` | number[] | Forced speed config — only meaningful when `an` is off for that port (not exposed — unconfirmed encoding) |
| `tfct` | bitmask | TX flow control currently active (read-only status, subset of `lnk`) |
| `rfct` | bitmask | RX flow control currently active (read-only status, subset of `lnk`) |
| `prt` | number | Total port count (read-only) |

`fctc`/`fctr` are the two independent per-port checkboxes shown in the SwOS UI
("TX Flow Control" / "RX Flow Control"); `tfct`/`rfct` are the read-only
column showing what's actually negotiated and are never written.

**POST** (send all writable fields together — `en`, `an`, `nm`, `fctc`, `fctr`,
`sfpr`, plus `dpxc`/`spdc` echoed back verbatim since their semantics are
unconfirmed; omitting a writable field risks it being silently reset, as
`vlan.b` does for `igmp`/`piso`/`lrn`/`mrr`):

```
{en:0x01ff,an:0x01ff,nm:['506f727431','506f727432',...],fctc:0x01ff,fctr:0x0000,sfpr:[0x00,...,0x01,0x01],dpxc:0x01ff,spdc:[0x00,...]}
```

---

### `fwd.b` — Per-port VLAN forwarding

**GET response** (object with per-port arrays, one element per port):

| Field | Type | Description |
|---|---|---|
| `vlan` | number[] | VLAN mode per port (0–3, see below) |
| `vlni` | number[] | 802.1Q acceptable frame types per port (0=any, 1=tagged-only, 2=untagged-only — see below) |
| `dvid` | number[] | Default VLAN ID for untagged ingress frames |
| `fvid` | number | Single scalar bitmask, not per-port. Purpose unconfirmed; read and preserved verbatim on every POST, never interpreted. |

**VLAN mode values** (SwOS full — 4 values):

| Value | Name | Behaviour |
|---|---|---|
| 0 | disabled | VLAN engine disabled on this port |
| 1 | optional | Use VLAN tag if present, else use default VLAN |
| 2 | enabled | Must match a VLAN entry |
| 3 | strict | Drop frames not matching any VLAN |

> **CSS318/CSS326 note**: Factory default VLAN mode is `optional` (1), not
> `disabled` (0). SwOS Lite uses only 3 modes (0=disabled, 1=optional, 2=strict).

**`vlni` — acceptable frame types**:

| Value | Name | Behaviour |
|---|---|---|
| 0 | any | Accept both tagged and untagged frames |
| 1 | tagged | Accept only VLAN-tagged frames — used on trunk ports carrying multiple VLANs |
| 2 | untagged | Accept only untagged frames — used on single-VLAN access ports |

**POST**: send all four fields together, preserving any fields you don't want
to change (`fvid` is a scalar, not an array):

```
{vlan:[0x01,0x01,...],vlni:[0x02,0x01,...],dvid:[0x58,0x08,...],fvid:0x00004000}
```

---

### `vlan.b` — VLAN table

**GET response** (array of objects, one per VLAN entry):

| Field | Type | Description |
|---|---|---|
| `vid` | number | VLAN ID (1–4094) |
| `mbr` | bitmask | Member ports |
| `nm` | hex-string | VLAN name |
| `igmp` | number | IGMP snooping: 0=off, 1=on — single toggle for the whole VLAN, **not** per-port |
| `piso` | number | Port isolation: 0=off, 1=on — single toggle for the whole VLAN, **not** per-port |
| `lrn` | number | MAC learning: 0=off, 1=on — single toggle for the whole VLAN, **not** per-port |
| `mrr` | number | Mirroring: 0=off, 1=on — single toggle for the whole VLAN, **not** per-port |

Confirmed by comparing a live dump across VLANs with differing `mbr` values:
`igmp`/`piso`/`lrn`/`mrr` stayed identical regardless of membership, ruling out
a per-port bitmask.

**POST**: send the complete desired VLAN table as an array, including all
seven fields per entry. The switch replaces its VLAN table entirely — omitting
a VLAN removes it.

```
[{vid:0x08,mbr:0x02000000,nm:'7573657273',igmp:0x00,piso:0x01,lrn:0x01,mrr:0x00},{...}]
```

---

### Other endpoints

| Endpoint | Description |
|---|---|
| `lag.b` | LACP/LAG bonding config |
| `snmp.b` | SNMP enable/community/contact/location |
| `sfp.b` | SFP transceiver info (read-only) |
| `!dhost.b` | Learned MAC address table (read-only) |
| `backup.swb` | Binary config backup (GET to download, multipart POST to restore) |

---

## Worked example — change port name

```
GET /link.b
← {en:0x03ffff,an:0x03ffff,nm:['506f727431','506f727432',...],fctc:0x03ffff,fctr:0x00,sfpr:[...],lnk:0x03ffff,prt:0x12}

# "Port1" = 0x506f727431, change to "uplink" = 0x75706c696e6b
POST /link.b
→ {en:0x03ffff,an:0x03ffff,nm:['75706c696e6b','506f727432',...],fctc:0x03ffff,fctr:0x00,sfpr:[...]}
```

---

## CSS318-specific notes

- **Model**: CSS318-16G-2S+ (16 × GbE copper + 2 × SFP+) = **18 ports**
- **Firmware**: SwOS (full), not SwOS Lite — confirmed by [PR #4](https://github.com/lanrat/python-mikrotik-swos/pull/4)
- **Field names**: descriptive (`en`, `nm`, `vlan`, `dvid`, etc.) — same as CRS series
- **VLAN modes**: 4-value set (disabled/optional/enabled/strict)
- **Factory VLAN mode**: `optional` on all ports out of box
- **Platform detection**: check field names in `sys.b` — if `id`/`ver`/`brd` are present → SwOS full; if `i01`/`i07` → SwOS Lite

---

## Implementation notes (`swos.ts`)

- Auto-detects port count from the length of the `nm` array in `link.b`
- Applies only changed data — reads current state, diffs, only POSTs to
  endpoints where something changed
- `dump-swos` reads current state and emits a YAML config that can be
  edited and fed back to `apply-swos`
- No external HTTP library needed — uses Node's native `fetch` + `crypto`
  for Digest auth

---

## Unimplemented features

### `sys.b` — IP configuration (`cip`)

The switch's own IP address, netmask, gateway, and DHCP/static mode are stored
in `cip`. The exact encoding is undocumented and varies between DHCP and static
modes — it would need to be reverse-engineered by reading a live switch
configured both ways and diffing the raw responses. Until then, the switch IP
must be managed outside this tool (DHCP reservation or web UI).

### `sys.b` — Management ACL (`aci`)

`aci` restricts which source IPs are allowed to manage the switch. Structure
unknown without live testing.

### `link.b` — Forced speed/duplex (`spdc`, `dpxc`)

In the SwOS UI, turning off auto-negotiation (`an`) for a port unlocks manual
"Speed" and "Full Duplex" selectors. These almost certainly write to `spdc`
and `dpxc` respectively (paired with the read-only observed `spd`/`dpx`), but
every port on the switch used to reverse-engineer this API has `an` enabled,
so there's no live sample of what `spdc`/`dpxc` look like with a specific
speed/duplex forced — the exact enum/bit values are unconfirmed. Both fields
are read and round-tripped unchanged on every `link.b` POST but not exposed
as config options. To implement: on a test port, disable auto-negotiation and
try each speed/duplex combination in the UI, diffing `link.b` before/after
each change.

### `fwd.b` — Force VLAN ID (`fvid`)

`fvid` is a single scalar bitmask (not per-port, not an array). Its semantics
are unconfirmed and it's not exposed in the config schema; `swos.ts` treats
it as opaque (`unknown`), reading whatever the switch returns and echoing it
back verbatim on `fwd.b` POST without assuming any shape.

### `lag.b` — Link aggregation (LACP)

Controls LACP bonding mode and group membership per port. Entire endpoint not
implemented. Fields (SwOS full): `lm` (LAG mode per port), `lg` (LAG group per
port), `lt` (trunk ID), `lp` (partner info bitmask).

### `snmp.b` — SNMP

Controls SNMP enable/disable, community string, contact, and location. Entire
endpoint not implemented. Fields: `en` (enabled), `com` (community hex-string),
`con` (contact hex-string), `loc` (location hex-string). Straightforward to add.

### `sfp.b` — SFP transceiver info

Read-only. Returns vendor, model, wavelength, temperature, Tx/Rx power for each
SFP port. Useful for monitoring but has no writable counterpart.

### `!dhost.b` — Learned MAC table

Read-only. Returns dynamically learned MAC addresses with associated port and
VLAN. The leading `!` in the endpoint name is literal. Useful for diagnostics.

### `backup.swb`

`GET /backup.swb` returns a binary `.swb` file containing the full switch
config. `POST /backup.swb` (multipart form) restores it and reboots the switch.
Useful as a fallback mechanism but the binary format is opaque.
