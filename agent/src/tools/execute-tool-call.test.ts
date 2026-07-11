import assert from "node:assert/strict";
import test from "node:test";

import { executeToolCall } from "./execute-tool-call.js";
import { cropLookupTool } from "./crop-lookup.js";

test("dispatches a validated call to the matching tool", async () => {
  const result = await executeToolCall(
    {
      id: "toolu_test",
      name: "lookup_crop",
      input: { crop: "corn" }
    },
    [cropLookupTool]
  );

  assert.equal(result.id, "toolu_test");
  assert.equal(result.name, "lookup_crop");
  assert.deepEqual(result.output, {
    found: true,
    crop: {
      crop: "corn",
      soilPhMin: 5.8,
      soilPhMax: 7,
      notes:
        "Corn grows best in well-drained, fertile soil with consistent moisture."
    }
  });
});

test("fails if the validated tool is no longer registered", async () => {
  await assert.rejects(
    executeToolCall(
      {
        id: "toolu_test",
        name: "lookup_crop",
        input: { crop: "corn" }
      },
      []
    ),
    /Validated tool lookup_crop is no longer registered/
  );
});
