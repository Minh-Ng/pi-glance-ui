import assert from "node:assert/strict";
import { test } from "node:test";

import glanceUi from "../src/index.js";
import { ToolTimeline } from "../src/timeline.js";
import { SectionController } from "../src/ui/sections.js";

const SHARED_RUNTIME_STATE = Symbol.for("pi-compact-ui.shared-runtime-state");

test("hot reload backfills constructor fields added by a newer generation", (t) => {
  const previousRuntime = globalThis[SHARED_RUNTIME_STATE];
  t.after(() => {
    if (previousRuntime === undefined) delete globalThis[SHARED_RUNTIME_STATE];
    else globalThis[SHARED_RUNTIME_STATE] = previousRuntime;
  });

  const sectionController = new SectionController();
  const timeline = new ToolTimeline(sectionController);
  const retainedEntry = { id: "retained" };
  timeline.entriesById.set(retainedEntry.id, retainedEntry);
  delete timeline.expansionStateByGroupId;
  globalThis[SHARED_RUNTIME_STATE] = { sectionController, timeline };

  glanceUi({
    on() {},
    registerCommand() {},
    registerShortcut() {},
  });

  const migrated = globalThis[SHARED_RUNTIME_STATE];
  assert.equal(migrated.timeline, timeline, "the active transcript state should be retained");
  assert.equal(migrated.timeline.entriesById.get(retainedEntry.id), retainedEntry);
  assert.ok(migrated.timeline.expansionStateByGroupId instanceof Map);
  assert.doesNotThrow(() => migrated.timeline.registerForTurn(
    "next",
    "explore",
    "plan",
    [],
    true,
  ));
});
