import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { parse } from "yaml";
import { credentialsSecret, esoNamespace } from "./lib/k8s/secrets.ts";
import {
  expand,
  fluxGitToken,
  loadStages,
  plan,
  type Stage,
} from "./bootstrap.ts";

const stages: Stage[] = [
  { name: "one", apply: ["crds"], serverSide: true, forceConflicts: true },
  {
    name: "two",
    apply: ["a", "b"],
    run: [{ command: ["echo", "${WHO:-world}"], retry: 5 }],
  },
  {
    name: "three",
    run: [{ command: ["flux", "--branch=${BRANCH}"], requires: ["TOKEN"] }],
  },
  { name: "four", kustomizations: [{ name: "boot", path: "./apps/flux" }] },
];

const opts = { builtDir: "out", env: { BRANCH: "main" } };

describe("expand", () => {
  test("uses the environment, then the default", () => {
    assert.equal(expand("${A:-x}", { A: "1" }), "1");
    assert.equal(expand("${A:-x}", {}), "x");
    assert.equal(expand("--b=${B}", { B: "2" }), "--b=2");
  });

  test("fails on an unset variable without a default", () => {
    assert.throws(() => expand("${MISSING}", {}), /MISSING is not set/);
  });
});

describe("plan", () => {
  test("applies each app, server-side when asked", () => {
    const steps = plan(stages, opts);
    assert.deepEqual(steps[0].command, [
      "kubectl",
      "apply",
      "--server-side",
      "--force-conflicts",
      "-f",
      "out/apps/crds/manifest.yaml",
    ]);
    assert.deepEqual(steps[1].command, [
      "kubectl",
      "apply",
      "-f",
      "out/apps/a/manifest.yaml",
    ]);
  });

  test("expands run commands and keeps retry and requires", () => {
    const steps = plan(stages, opts);
    const echo = steps.find((s) => s.command[0] === "echo")!;
    assert.deepEqual(echo.command, ["echo", "world"]);
    assert.equal(echo.retry, 5);
    assert.deepEqual(steps.find((s) => s.command[0] === "flux")!.requires, [
      "TOKEN",
    ]);
  });

  test("creates a flux kustomization from its name and path, applying it from standard input", () => {
    const step = plan(stages, { ...opts, only: "four" })[0];
    assert.deepEqual(step.command, ["kubectl", "apply", "-f", "-"]);
    const object = parse(step.input!);
    assert.equal(object.kind, "Kustomization");
    assert.equal(object.metadata.name, "boot");
    assert.equal(object.spec.path, "./apps/flux");
    assert.equal(object.spec.sourceRef.name, "flux-system");
  });

  test("--from starts at a stage and --only runs one", () => {
    assert.deepEqual(
      [...new Set(plan(stages, { ...opts, from: "two" }).map((s) => s.stage))],
      ["two", "three", "four"],
    );
    assert.deepEqual(
      [...new Set(plan(stages, { ...opts, only: "two" }).map((s) => s.stage))],
      ["two"],
    );
  });

  test("rejects unknown stages", () => {
    assert.throws(
      () => plan(stages, { ...opts, from: "nope" }),
      /unknown stage 'nope'/,
    );
  });
});

describe("bootstrap.yaml", () => {
  test("is valid and plans with the defaults", () => {
    const real = loadStages("../bootstrap.yaml");
    const steps = plan(real, { builtDir: "out", env: {} });
    const flux = steps.find((s) => s.command[0] === "flux")!;
    assert.ok(flux.command.includes("--branch=main"));
    assert.deepEqual(flux.requires, ["FLUX_GIT_TOKEN"]);
    assert.deepEqual(
      real.map((s) => s.name),
      [
        "cluster-ready",
        "crds",
        "network-policy",
        "cilium",
        "flux",
        "flux-bootstrap",
        "external-secrets",
      ],
    );
  });

  test("gives the cluster the token external secrets reads bitwarden with, to the place and name the app expects", () => {
    const steps = plan(loadStages("../bootstrap.yaml"), {
      builtDir: "out",
      env: {},
      only: "external-secrets",
    });
    const [wait, create] = steps.map((s) => s.command.join(" "));
    assert.ok(wait.includes(`namespace/${esoNamespace}`));
    assert.ok(create.includes(`create secret generic ${credentialsSecret}`));
    assert.ok(create.includes(`--namespace=${esoNamespace}`));
    assert.ok(create.includes("eso-bws-token"));
    assert.deepEqual(
      steps.map((s) => s.retry),
      [900, undefined],
    );
  });

  test("reads ESO_BWS_TOKEN in the shell, so the token is not in the command it plans", () => {
    const steps = plan(loadStages("../bootstrap.yaml"), {
      builtDir: "out",
      env: { ESO_BWS_TOKEN: "secret-value" },
      only: "external-secrets",
    });
    const create = steps[1].command.join(" ");
    assert.ok(create.includes("ESO_BWS_TOKEN"));
    assert.ok(!create.includes("secret-value"));
  });
});

describe("fluxGitToken", () => {
  const home = join(tmpdir(), `bootstrap-test-${process.pid}`);
  const saved = { ...process.env };

  const flux = (content: string, mode = 0o600) => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "flux-git-token"), content, { mode });
    chmodSync(join(home, "flux-git-token"), mode);
  };

  beforeEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.FLUX_GIT_TOKEN;
    process.env.HOMELAB_DIR = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    process.env = { ...saved };
  });

  test("is the environment variable, when set", () => {
    flux("from-file\n");
    process.env.FLUX_GIT_TOKEN = "from-env";
    assert.equal(fluxGitToken(), "from-env");
  });

  test("is the contents of the flux-git-token file, otherwise", () => {
    flux("from-file\n");
    assert.equal(fluxGitToken(), "from-file");
  });

  test("is nothing without either", () => {
    assert.equal(fluxGitToken(), undefined);
  });

  test("rejects an empty flux-git-token file", () => {
    flux("\n");
    assert.throws(() => fluxGitToken(), /flux-git-token is empty/);
  });

  test("rejects a flux-git-token file others can read", () => {
    flux("x\n", 0o644);
    assert.throws(() => fluxGitToken(), /must be readable by its owner only/);
  });
});
