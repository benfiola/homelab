import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// renovate has no manager for typescript: images in app.ts are found by the regex rules of renovate.json,
// which these tests use, so an image renovate can't see fails here

const root = join(import.meta.dirname, "../..");
const config = JSON.parse(readFileSync(join(root, "renovate.json"), "utf-8"));

interface Manager {
  description: string;
  managerFilePatterns: string[];
  matchStrings: string[];
}

const managers: Manager[] = config.customManagers;

// renovate writes file patterns as "/regex/"
const filePattern = (pattern: string) => new RegExp(pattern.slice(1, -1));
const managersFor = (file: string) =>
  managers.filter((m) =>
    m.managerFilePatterns.some((p) => filePattern(p).test(file)),
  );

// every typescript file renovate is expected to find images in
const typescriptFiles = [
  ...readdirSync(join(root, "apps"))
    .map((app) => `apps/${app}/app.ts`)
    .filter((file) => existsSync(join(root, file))),
  "tools/lib/images.ts",
];

// any quoted "org/name:1.2.3" in the source looks like an image
const imageLike = /"((?:[a-z0-9.-]+\/)+[\w.-]+):(v?\d[\w.-]*)"/g;

describe("renovate.json", () => {
  test("custom manager regexes avoid what renovate's regex engine (RE2) can't do", () => {
    for (const manager of managers) {
      for (const matchString of manager.matchStrings) {
        assert.doesNotMatch(
          matchString,
          /\(\?<?[=!]|\\[1-9]/,
          `${manager.description}: lookaround or backreference`,
        );
        assert.doesNotThrow(
          () => new RegExp(matchString, "g"),
          manager.description,
        );
      }
    }
  });

  test("every custom manager captures what renovate requires", () => {
    for (const manager of managers) {
      for (const matchString of manager.matchStrings) {
        assert.match(
          matchString,
          /\(\?<currentValue>/,
          `${manager.description}: no currentValue`,
        );
        assert.match(
          matchString,
          /\(\?<depName>/,
          `${manager.description}: no depName`,
        );
      }
    }
  });
});

// what the rules find in a file, as the text each match covers
const found = (
  file: string,
  source: string,
  only?: (manager: Manager) => boolean,
) => {
  const matches: string[] = [];
  for (const manager of managersFor(file).filter(only ?? (() => true))) {
    for (const matchString of manager.matchStrings) {
      for (const m of source.matchAll(new RegExp(matchString, "g"))) {
        matches.push(m[0]);
      }
    }
  }
  return matches;
};

describe("sources in typescript", () => {
  const sources = typescriptFiles
    .filter((file) => file.startsWith("apps/"))
    .map((file) => ({
      file,
      source: readFileSync(join(root, file), "utf-8"),
    }));

  test("every helm chart is found, which needs it written as a url with ?version=", () => {
    const missed: string[] = [];
    let charts = 0;
    for (const { file, source } of sources) {
      const calls = [...source.matchAll(/\bh\.helm\(/g)].length;
      const matched = found(file, source, (m) =>
        m.matchStrings.some((s) => s.includes("h\\.helm\\(")),
      ).length;
      charts += calls;
      if (calls !== matched) {
        missed.push(`${file}: ${calls} charts, ${matched} found`);
      }
    }
    assert.ok(charts > 20, `only ${charts} charts`);
    assert.deepEqual(missed, []);
  });

  // a manifest url given to kustomize is found as a versioned url instead (below)
  test("every upstream kustomize overlay is found, which needs it pinned with ?ref=", () => {
    const missed: string[] = [];
    for (const { file, source } of sources) {
      const calls = [...source.matchAll(/\bh\.kustomize\(\s*"(?!https:)/g)]
        .length;
      const matched = found(file, source, (m) =>
        m.matchStrings.some((s) => s.includes("h\\.kustomize")),
      ).length;
      if (calls !== matched) {
        missed.push(`${file}: ${calls} overlays, ${matched} found`);
      }
    }
    assert.deepEqual(missed, []);
  });

  test("every versioned url is found", () => {
    const missed: string[] = [];
    for (const { file, source } of sources) {
      const matched = found(file, source);
      for (const m of source.matchAll(/https:\/\/[^"\s`]+/g)) {
        const versioned = /\/(v\d[^/]*|refs\/tags\/[^/]+)\//.test(m[0]);
        // a url's version is found if some match covers it (a chart repository carries none)
        if (
          versioned &&
          !matched.some(
            (hit) => m[0].startsWith(hit) || hit.startsWith(m[0].slice(0, 40)),
          )
        ) {
          missed.push(`${file}: ${m[0]}`);
        }
      }
    }
    assert.deepEqual(
      missed,
      [],
      "a url with a version in it that no rule updates",
    );
  });
});

describe("images in typescript", () => {
  test("there are files to check", () => {
    assert.ok(typescriptFiles.length > 10);
    assert.ok(
      typescriptFiles.every((file) => managersFor(file).length > 0),
      "a typescript file no manager covers",
    );
  });

  test("every image is found by the rules", () => {
    const missed: string[] = [];
    let found = 0;
    for (const file of typescriptFiles) {
      const source = readFileSync(join(root, file), "utf-8");
      const matched = new Set<string>();
      for (const manager of managersFor(file)) {
        for (const matchString of manager.matchStrings) {
          for (const m of source.matchAll(new RegExp(matchString, "g"))) {
            matched.add(`${m.groups!.depName}:${m.groups!.currentValue}`);
          }
        }
      }
      found += matched.size;
      for (const m of source.matchAll(imageLike)) {
        if (!matched.has(`${m[1]}:${m[2]}`)) {
          missed.push(`${file}: ${m[1]}:${m[2]}`);
        }
      }
    }
    assert.ok(found > 20, `only ${found} images found`);
    assert.deepEqual(
      missed,
      [],
      'write images as `image: "repo/name:tag"` so renovate can see them',
    );
  });

  test("no image is built dynamically", () => {
    const dynamic: string[] = [];
    for (const file of typescriptFiles) {
      const source = readFileSync(join(root, file), "utf-8");
      for (const m of source.matchAll(/\bimage:\s*`[^`]*`/g)) {
        dynamic.push(`${file}: ${m[0]}`);
      }
    }
    assert.deepEqual(
      dynamic,
      [],
      "an image in a template literal is invisible to renovate",
    );
  });
});
