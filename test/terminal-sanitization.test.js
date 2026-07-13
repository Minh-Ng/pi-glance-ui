import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactContent,
  getToolErrorMessage,
  sanitizeTerminalText,
  summarize,
} from "../src/format.js";

const OSC_CLIPBOARD = "\u001b]52;c;UExBQ0VIT0xERVI=\u0007";
const CSI_CLEAR = "\u001b[2J";

test("removes terminal control sequences before rendering transcript text", () => {
  assert.equal(
    sanitizeTerminalText(`before${OSC_CLIPBOARD}middle${CSI_CLEAR}after\u0000`),
    "beforemiddleafter",
  );
  assert.equal(
    getToolErrorMessage({
      content: [{ type: "text", text: `failed ${OSC_CLIPBOARD} safely` }],
    }),
    "failed safely",
  );
  assert.equal(
    summarize("bash", { command: `printf ok ${OSC_CLIPBOARD}` }),
    "printf ok",
  );
  assert.equal(
    artifactContent({ content: `artifact${CSI_CLEAR}\ncontent` }),
    "artifact\ncontent",
  );
});
