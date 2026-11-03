import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkTemplate, renderTemplate } from "./template.ts";

describe("renderTemplate", () => {
  test("fills in values by path", () => {
    assert.equal(
      renderTemplate("a={{ x.y }} b={{z}}", { x: { y: 1 }, z: "two" }),
      "a=1 b=two",
    );
  });

  test("fills in the same value wherever it appears", () => {
    assert.equal(renderTemplate("{{ a }} {{ a }}", { a: "x" }), "x x");
  });

  test("a value that isn't there is an error that names it, never an empty string", () => {
    assert.throws(
      () =>
        renderTemplate(
          "{{ secrets.wifi.iot }}",
          { secrets: { wifi: {} } },
          "ap.sh",
        ),
      /ap\.sh: 'secrets\.wifi\.iot' is not defined/,
    );
    assert.throws(
      () => renderTemplate("{{ a.b }}", { a: null }),
      /'a\.b' is not defined/,
    );
  });

  test("leaves other text alone, braces included", () => {
    assert.equal(
      renderTemplate("{ not a template } ${x} {{ a }}", { a: 1 }),
      "{ not a template } ${x} 1",
    );
  });

  test("values are not themselves templates", () => {
    assert.equal(renderTemplate("{{ a }}", { a: "{{ b }}" }), "{{ b }}");
  });
});

describe("checkTemplate", () => {
  test("refuses what the old template engine did and this doesn't", () => {
    assert.throws(
      () => checkTemplate("{% if x %}y{% endif %}", "t"),
      /t: '\{%' is not supported/,
    );
    assert.throws(() => checkTemplate("{# comment #}", "t"), /not supported/);
    assert.doesNotThrow(() => checkTemplate("{{ plain }}", "t"));
  });
});
