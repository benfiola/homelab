import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { crdsApp, fluxDeclaration, listApps, networkFunction } from "./apps.ts";

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const apps = (modules: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "apps-"));
  dirs.push(dir);
  for (const [name, source] of Object.entries(modules)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "app.ts"), source);
  }
  writeFileSync(join(dir, "package.json"), "{}");
  return dir;
};

describe("listApps", () => {
  test("lists the directories by name, not the files", () => {
    assert.deepEqual(listApps(apps({ b: "", a: "" })), ["a", "b"]);
  });
});

describe("fluxDeclaration", () => {
  const dir = apps({
    quiet: "export const app = () => {};",
    custom:
      "export const flux = { dependsOn: ['crds'] }; export const app = () => {};",
    off: "export const flux = false; export const app = () => {};",
    // reading the declaration must not run the app
    loud: "export const app = () => { throw new Error('ran'); };",
  });

  test("is what the app exports as flux", async () => {
    assert.deepEqual(await fluxDeclaration(dir, "custom"), {
      dependsOn: ["crds"],
    });
    assert.equal(await fluxDeclaration(dir, "off"), false);
  });

  test("is nothing for an app that says nothing, without running it", async () => {
    assert.equal(await fluxDeclaration(dir, "quiet"), undefined);
    assert.equal(await fluxDeclaration(dir, "loud"), undefined);
  });

  test("the generated crds app has no module, and says nothing", async () => {
    assert.equal(await fluxDeclaration(dir, crdsApp), undefined);
  });
});

describe("networkFunction", () => {
  const dir = apps({
    quiet: "export const app = () => {};",
    declared:
      "export const network = () => 'declared'; export const app = () => { throw new Error('ran'); };",
    broken: "export const network = 1; export const app = () => {};",
  });

  test("is the network of an app, read without running the app", async () => {
    const network = await networkFunction(dir, "declared");
    assert.equal((network as any)(), "declared");
  });

  test("is nothing for an app that declares none, and for the generated crds app", async () => {
    assert.equal(await networkFunction(dir, "quiet"), undefined);
    assert.equal(await networkFunction(dir, crdsApp), undefined);
  });

  test("a network that isn't a function is an error that says so", async () => {
    await assert.rejects(
      () => networkFunction(dir, "broken"),
      /'network' must be a function/,
    );
  });
});
