import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { applyConfig } from "./apply.ts";
import type { Run } from "./profiles/context.ts";
import { startSwitch, type FakeSwitch } from "./profiles/swos/fake.ts";
import { hexDecode } from "./profiles/swos/protocol.ts";

type Call = {
  command: string;
  args: string[];
  input?: string;
  interactive?: boolean;
};

const recorder = () => {
  const calls: Call[] = [];
  const copies: string[] = [];
  const run: Run = async (command, args, options = {}) => {
    calls.push({ command, args, ...options });
    // scp's source is deleted when apply returns
    if (command === "scp") copies.push(readFileSync(args[0], "utf-8"));
  };
  const log: string[] = [];
  return { calls, copies, log, run, say: (m: string) => log.push(m) };
};

describe("openwrt", () => {
  test("writes the script to the device, runs it, and removes it", async () => {
    const r = recorder();
    await applyConfig("openwrt", "uci commit\n", {
      address: "192.168.1.1",
      run: r.run,
      log: r.say,
    });
    assert.equal(r.calls.length, 2);
    assert.deepEqual(r.calls[0].args[0], "root@192.168.1.1");
    assert.match(r.calls[0].args[1], /umask 077 && cat > \/tmp\/homelab\.sh/);
    assert.equal(r.calls[0].input, "uci commit\n");
    assert.match(
      r.calls[1].args[1],
      /sh \/tmp\/homelab\.sh; status=\$\?; rm -f \/tmp\/homelab\.sh; exit \$status/,
    );
    assert.match(r.log.join("\n"), /set the admin password .* reboot/);
  });

  test("a dry run runs nothing", async () => {
    const r = recorder();
    await applyConfig("openwrt", "x", {
      address: "a",
      user: "me",
      dryRun: true,
      run: r.run,
      log: r.say,
    });
    assert.deepEqual(r.calls, []);
    assert.match(r.log[0], /would run: ssh me@a /);
    assert.match(r.log.at(-1)!, /dry run: nothing written/);
  });
});

describe("routeros", () => {
  test("copies the script, and says how to reset the router to it", async () => {
    const r = recorder();
    await applyConfig("routeros", "/system/identity/set name=router\n", {
      address: "192.168.1.1",
      run: r.run,
      log: r.say,
    });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].command, "scp");
    assert.equal(r.calls[0].args[1], "admin@192.168.1.1:script.rsc");
    assert.deepEqual(r.copies, ["/system/identity/set name=router\n"]);
    assert.equal(existsSync(r.calls[0].args[0]), false);
    assert.match(
      r.log[0],
      /ssh -t admin@192\.168\.1\.1 \/system\/reset-configuration no-defaults=yes run-after-reset=script\.rsc/,
    );
  });

  test("--reset runs the reset on the terminal, so the router can ask", async () => {
    const r = recorder();
    await applyConfig("routeros", "x", {
      address: "a",
      reset: true,
      run: r.run,
      log: r.say,
    });
    assert.deepEqual(
      r.calls.map((c) => c.command),
      ["scp", "ssh"],
    );
    assert.equal(r.calls[1].interactive, true);
    assert.deepEqual(r.calls[1].args.slice(0, 2), ["-t", "admin@a"]);
  });

  test("a dry run copies nothing, and never writes the script", async () => {
    const r = recorder();
    await applyConfig("routeros", "secret", {
      address: "a",
      reset: true,
      dryRun: true,
      run: r.run,
      log: r.say,
    });
    assert.deepEqual(r.calls, []);
    assert.equal(r.log.length, 3);
  });
});

describe("swos", () => {
  const switches: FakeSwitch[] = [];
  after(() => Promise.all(switches.map((s) => s.close())));

  test("applies the configuration to the switch", async () => {
    const fake = await startSwitch();
    switches.push(fake);
    const r = recorder();
    await applyConfig("swos", "system:\n  identity: lab\n", {
      address: fake.address,
      log: r.say,
    });
    assert.equal(hexDecode(fake.state.sys.id), "lab");
    assert.equal(r.log[0], `${fake.address}: 18 ports`);
    assert.equal(r.log.at(-1), "applied");
  });

  test("a dry run changes nothing", async () => {
    const fake = await startSwitch();
    switches.push(fake);
    const r = recorder();
    await applyConfig("swos", "system:\n  identity: lab\n", {
      address: fake.address,
      dryRun: true,
      log: r.say,
    });
    assert.equal(hexDecode(fake.state.sys.id), "MikroTik");
    assert.equal(r.log.at(-1), "dry run: nothing written");
  });
});

test("a wireguard client is imported on the device, not applied", async () => {
  await assert.rejects(
    applyConfig("wireguard", "x", { address: "a" }),
    /imported on the device/,
  );
});
