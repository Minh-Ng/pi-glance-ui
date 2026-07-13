import assert from "node:assert/strict";
import { test } from "node:test";

import { wrapThinkingLines } from "../src/format.js";

function continuationsAreIndented(output) {
  const lines = output.split("\n");
  // Every line after a branch/label line that is a wrap continuation must be
  // indented (never start at column 0), so it stays inside the thinking block.
  return lines.every((line, index) => {
    if (index === 0) return true;
    if (/^(?:[○●] )?[▸▾] Thinking/.test(line)) return true; // header
    if (/^\s*[├└] /.test(line)) return true; // branch start
    // Anything else is a wrap continuation and must be indented.
    return /^\s{2,}\S/.test(line) || line.trim() === "";
  });
}

test("multi-section thinking wraps with a hanging indent under each branch", () => {
  const source = [
    "○ ▸ Thinking",
    "  ├ First section that is quite long and should wrap nicely under the branch connector",
    "  └ Second section also long enough to require wrapping across several lines here",
  ].join("\n");
  const wrapped = wrapThinkingLines(source, 50);
  assert.ok(continuationsAreIndented(wrapped), `continuation broke out:\n${wrapped}`);
  // Content is preserved (whitespace-insensitive).
  assert.equal(
    wrapped.replace(/\s+/g, " ").trim(),
    source.replace(/\s+/g, " ").trim(),
  );
  // At least one real wrap happened.
  assert.ok(wrapped.split("\n").length > source.split("\n").length);
});

test("single-section thinking hangs under the Thinking: label", () => {
  const source = "○ ▸ Thinking: The CI passed so the fix is verified on the branch they run from now";
  const wrapped = wrapThinkingLines(source, 40);
  assert.ok(continuationsAreIndented(wrapped), `continuation broke out:\n${wrapped}`);
  const cont = wrapped.split("\n").slice(1);
  assert.ok(cont.length >= 1);
  // Hanging indent aligns under the text after "○ ▸ Thinking: ".
  const labelWidth = Array.from("○ ▸ Thinking: ").length;
  assert.ok(cont.every((line) => line.startsWith(" ".repeat(labelWidth))));
});

test("short thinking text is returned unchanged", () => {
  const source = "○ ▸ Thinking: brief thought";
  assert.equal(wrapThinkingLines(source, 80), source);
});

test("width is clamped so tiny widths never throw", () => {
  const source = "○ ▸ Thinking\n  └ some longer content that must still wrap without error";
  assert.doesNotThrow(() => wrapThinkingLines(source, 1));
  assert.ok(continuationsAreIndented(wrapThinkingLines(source, 1)));
});
