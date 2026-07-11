import assert from "node:assert/strict";
import test from "node:test";

import { cropLookupTool } from "./crop-lookup.js";

test("finds corn regardless of whitespace or capitalization", async () => {
  const result = await cropLookupTool.execute({ crop: "  CORN " });

  assert.equal(result.found, true);
  if (result.found) {
    assert.equal(result.crop.soilPhMin, 5.8);
    assert.equal(result.crop.soilPhMax, 7.0);
  }
});

test("returns a typed not-found result for an unsupported crop", async () => {
  const result = await cropLookupTool.execute({ crop: "rice" });

  assert.deepEqual(result, { found: false, crop: "rice" });
});
