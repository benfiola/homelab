import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultRetain, defaultSchedule, volsyncBackup } from "./volsync.ts";

describe("volsyncBackup", () => {
  test("backs up the PVC to a repository named for its namespace and name", () => {
    const { secret, source } = volsyncBackup("config", "web");
    assert.equal(source.kind, "ReplicationSource");
    assert.equal(source.metadata.name, "config");
    assert.equal(source.spec.sourcePVC, "config");
    assert.equal(source.spec.restic.repository, "volsync-mover-config");
    assert.equal(secret.name, "volsync-mover-config");
    assert.equal(
      secret.templates.RESTIC_REPOSITORY,
      "b2:homelab-volsync-697438:/web/config",
    );
  });

  test("reads its credentials from volsync's section of the apps file", () => {
    const { secret } = volsyncBackup("config", "web");
    assert.deepEqual(Object.keys(secret.templates).sort(), [
      "B2_ACCOUNT_ID",
      "B2_ACCOUNT_KEY",
      "RESTIC_PASSWORD",
      "RESTIC_REPOSITORY",
    ]);
    for (const [key, name] of [
      ["B2_ACCOUNT_ID", "backblaze-application-key-id"],
      ["B2_ACCOUNT_KEY", "backblaze-application-key"],
      ["RESTIC_PASSWORD", "restic-password"],
    ]) {
      assert.match(secret.templates[key], new RegExp(`"volsync"\\)`));
      assert.match(secret.templates[key], new RegExp(`"${name}"`));
    }
  });

  test("runs daily at noon unless given a schedule", () => {
    assert.equal(defaultSchedule, "0 12 * * *");
    assert.equal(
      volsyncBackup("c", "n").source.spec.trigger.schedule,
      defaultSchedule,
    );
    assert.equal(
      volsyncBackup("c", "n", { schedule: "0 3 * * 0" }).source.spec.trigger
        .schedule,
      "0 3 * * 0",
    );
  });

  test("keeps the default snapshots unless given a policy, which replaces it whole", () => {
    assert.deepEqual(defaultRetain, { daily: 7, within: "1d" });
    assert.deepEqual(
      volsyncBackup("c", "n").source.spec.restic.retain,
      defaultRetain,
    );
    assert.deepEqual(
      volsyncBackup("c", "n", { retain: { weekly: 4, monthly: 6 } }).source.spec
        .restic.retain,
      { weekly: 4, monthly: 6 },
    );
  });

  test("the backup pod runs as the given user, restricted", () => {
    const { source } = volsyncBackup("c", "n", {
      securityContext: { uid: 1000, gid: 1000 },
    });
    const pod = source.spec.restic.moverSecurityContext;
    assert.equal(pod.runAsUser, 1000);
    assert.equal(pod.runAsGroup, 1000);
    assert.equal(pod.fsGroup, 1000);
    assert.equal(pod.runAsNonRoot, true);
  });

  test("the backup pod carries the label the network policy selects", () => {
    assert.deepEqual(
      volsyncBackup("c", "n").source.spec.restic.moverPodLabels,
      { "app.kubernetes.io/name": "volsync-mover" },
    );
  });
});
