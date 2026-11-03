import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { securityContext, vpa, Workload } from "./workload.ts";

describe("volumes", () => {
  const volumes = (v: Record<string, any>) =>
    new Workload("Deployment", "x", { volumes: v }).object().spec.template.spec
      .volumes;

  test("a config map or secret takes the mode it is given", () => {
    assert.deepEqual(
      volumes({
        cfg: { configMap: "cm", defaultMode: 0o400 },
        sec: { secret: "s", defaultMode: 0 },
      }).map((v: any) => (v.configMap ?? v.secret).defaultMode),
      [0o400, 0],
    );
  });

  test("and has none otherwise", () => {
    const [cfg, sec] = volumes({
      cfg: { configMap: "cm" },
      sec: { secret: "s" },
    });
    assert.equal("defaultMode" in cfg.configMap, false);
    assert.equal("defaultMode" in sec.secret, false);
  });
});

describe("securityContext", () => {
  test("is restricted by default: non-root, no escalation, no capabilities", () => {
    const { pod, container } = securityContext();
    assert.equal(container.allowPrivilegeEscalation, false);
    assert.deepEqual(container.capabilities, { drop: ["ALL"], add: [] });
    assert.equal(container.runAsNonRoot, true);
    assert.equal(pod.runAsNonRoot, true);
    assert.deepEqual(pod.seccompProfile, { type: "RuntimeDefault" });
  });

  test("runs as root only when asked to run as uid 0", () => {
    assert.equal(securityContext({ uid: 0 }).container.runAsNonRoot, false);
    assert.equal(securityContext({ uid: 1000 }).container.runAsNonRoot, true);
  });

  test("adds only the capabilities it is given, and the group it is given", () => {
    const { pod, container } = securityContext({ caps: ["NET_ADMIN"], gid: 7 });
    assert.deepEqual(container.capabilities.add, ["NET_ADMIN"]);
    assert.equal(pod.fsGroup, 7);
    assert.equal(container.runAsGroup, 7);
  });
});

describe("Workload", () => {
  const claim = { pvc: { size: "1Gi", storageClass: "fast" } };

  test("a deployment has a replica unless told otherwise, and the others have no replicas", () => {
    assert.equal(new Workload("Deployment", "x").object().spec.replicas, 1);
    assert.equal(
      new Workload("Deployment", "x", { replicas: 3 }).object().spec.replicas,
      3,
    );
    for (const kind of ["StatefulSet", "DaemonSet"] as const) {
      assert.equal("replicas" in new Workload(kind, "x").object().spec, false);
    }
  });

  test("a stateful set's pvc with a size is a claim template, not a volume", () => {
    const spec = new Workload("StatefulSet", "x", {
      volumes: { data: claim },
    }).object().spec;
    assert.deepEqual(spec.volumeClaimTemplates, [
      {
        metadata: { name: "data" },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "1Gi" } },
          storageClassName: "fast",
        },
      },
    ]);
    assert.deepEqual(spec.template.spec.volumes, []);
  });

  test("a workload without claims has no claim templates", () => {
    const spec = new Workload("StatefulSet", "x").object().spec;
    assert.equal("volumeClaimTemplates" in spec, false);
  });

  test("only a stateful set can have a claim template", () => {
    for (const kind of ["Deployment", "DaemonSet"] as const) {
      assert.throws(
        () => new Workload(kind, "x", { volumes: { data: claim } }),
        /does not support PVC templates \(data\)/,
      );
    }
    assert.throws(
      () => new Workload("Deployment", "x").addVolume("data", claim),
      /addVolume does not support PVC templates/,
    );
  });

  test("a pod template is annotated for stateful sets and daemon sets only", () => {
    const annotations = { a: "b" };
    const annotated = (kind: "Deployment" | "StatefulSet" | "DaemonSet") =>
      new Workload(kind, "x", { podAnnotations: annotations }).object().spec
        .template.metadata.annotations;
    assert.deepEqual(annotated("StatefulSet"), annotations);
    assert.deepEqual(annotated("DaemonSet"), annotations);
    assert.equal(annotated("Deployment"), undefined);
  });

  test("a service port is a number, or one of the forms that name a protocol or target", () => {
    const ports = new Workload("Deployment", "x").service({
      plain: 80,
      udp: [53, "UDP"],
      target: [80, 8080],
      full: [80, 8080, "UDP"],
      only: { targetPort: 9000 },
      both: { port: 90, targetPort: 9000, protocol: "UDP" },
    }).spec.ports;
    assert.deepEqual(ports, [
      { name: "plain", port: 80, protocol: "TCP" },
      { name: "udp", port: 53, protocol: "UDP" },
      { name: "target", port: 80, targetPort: 8080, protocol: "TCP" },
      { name: "full", port: 80, targetPort: 8080, protocol: "UDP" },
      { name: "only", port: 9000, protocol: "TCP" },
      { name: "both", port: 90, targetPort: 9000, protocol: "UDP" },
    ]);
  });
});

describe("vpa", () => {
  test("targets a workload, which is in apps/v1", () => {
    const v = vpa({ kind: "StatefulSet", name: "db" });
    assert.deepEqual(v.spec.targetRef, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "db",
    });
    assert.equal(v.metadata.name, "db");
    assert.equal(v.spec.updatePolicy.updateMode, "InPlaceOrRecreate");
  });

  test("targets anything else by the apiVersion it is given", () => {
    const v = vpa({
      kind: "Rollout",
      name: "r",
      apiVersion: "argoproj.io/v1alpha1",
    });
    assert.equal(v.spec.targetRef.apiVersion, "argoproj.io/v1alpha1");
  });

  test("only recommends, when advisory", () => {
    assert.equal(
      vpa({ kind: "Deployment", name: "d" }, { advisory: true }).spec
        .updatePolicy.updateMode,
      "Off",
    );
  });

  test("is in the namespace it is given, and otherwise in none", () => {
    assert.equal(
      vpa({ kind: "Deployment", name: "d" }, { namespace: "other" }).metadata
        .namespace,
      "other",
    );
    assert.equal(
      "namespace" in vpa({ kind: "Deployment", name: "d" }).metadata,
      false,
    );
  });
});
