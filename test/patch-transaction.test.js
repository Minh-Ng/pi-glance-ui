import assert from "node:assert/strict";
import { test } from "node:test";

import { PatchTransaction, runPatchTransaction } from "../src/patches/transaction.js";
import { patchHiddenThinkingLayout } from "../src/patches/layout.js";
import { ToolTimeline } from "../src/timeline.js";
import { SectionController } from "../src/ui/sections.js";

test("patch transaction restores absent, data, and symbol descriptors exactly", () => {
  const symbol = Symbol.for("pi-compact-ui.transaction-test");
  const target = {};
  const originalData = {
    value: "native",
    writable: false,
    enumerable: true,
    configurable: true,
  };
  const getter = () => "symbol-native";
  const originalSymbol = {
    get: getter,
    set: undefined,
    enumerable: false,
    configurable: true,
  };
  Object.defineProperty(target, "data", originalData);
  Object.defineProperty(target, symbol, originalSymbol);

  const transaction = new PatchTransaction();
  transaction.capture(target, ["absent", "data", symbol]);
  target.absent = "installed";
  Object.defineProperty(target, "data", {
    value: "wrapped",
    writable: true,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(target, symbol, {
    value: "symbol-wrapped",
    writable: true,
    enumerable: true,
    configurable: true,
  });
  transaction.rollback();

  assert.equal(Object.hasOwn(target, "absent"), false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "data"), originalData);
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, symbol), originalSymbol);
});

test("late verifier failure restores the prior-generation wrapper", async () => {
  const base = Symbol.for("pi-compact-ui.transaction-base-test");
  const priorWrapper = function priorGenerationWrapper() {};
  const native = function nativeMethod() {};
  const prototype = {};
  Object.defineProperty(prototype, "render", {
    value: priorWrapper,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(prototype, base, {
    value: native,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  const priorRenderDescriptor = Object.getOwnPropertyDescriptor(prototype, "render");
  const priorBaseDescriptor = Object.getOwnPropertyDescriptor(prototype, base);

  await assert.rejects(
    runPatchTransaction(async (transaction) => {
      transaction.capture(prototype, ["render", base, "lateStage"]);
      prototype.render = function currentGenerationWrapper() {};
      Object.defineProperty(prototype, base, {
        value: native,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      prototype.lateStage = true;
      await Promise.resolve();
      throw new Error("assistant verifier failed");
    }),
    /assistant verifier failed/,
  );

  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "render"), priorRenderDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, base), priorBaseDescriptor);
  assert.equal(Object.hasOwn(prototype, "lateStage"), false);
  assert.equal(prototype.render, priorWrapper);
});

class FailingStageTransaction extends PatchTransaction {
  constructor(failingStage) {
    super();
    this.failingStage = failingStage;
    this.originalDescriptors = [];
  }

  capture(target, ...properties) {
    for (const property of properties.flat()) {
      if (this.originalDescriptors.some(
        (entry) => entry.target === target && entry.property === property,
      )) continue;
      this.originalDescriptors.push({
        target,
        property,
        descriptor: Object.getOwnPropertyDescriptor(target, property),
      });
    }
    super.capture(target, ...properties);
  }

  checkpoint(stage) {
    if (stage === this.failingStage) throw new Error(`forced ${stage} failure`);
  }

  assertRestored() {
    for (const { target, property, descriptor } of this.originalDescriptors) {
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(target, property),
        descriptor,
        `descriptor was not restored after ${this.failingStage}: ${String(property)}`,
      );
    }
  }
}

function runtimeState() {
  const sectionController = new SectionController();
  return {
    sectionController,
    timeline: new ToolTimeline(sectionController),
  };
}

test("real patch installation rolls back every stage and preserves prior wrappers", async () => {
  const themeUrl = new URL(
    "./modes/interactive/theme/theme.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  const { initTheme } = await import(themeUrl.href);
  initTheme("dark");

  const stages = [
    "markdown",
    "userMessages",
    "footer",
    "tools",
    "customMessages",
    "runtimeErrors",
    "assistant",
  ];
  for (const stage of stages) {
    const transaction = new FailingStageTransaction(stage);
    const { sectionController, timeline } = runtimeState();
    const result = await patchHiddenThinkingLayout(
      timeline,
      sectionController,
      () => true,
      () => "auto",
      { transaction },
    );
    assert.equal(result.ok, false, stage);
    assert.match(result.error, new RegExp(`forced ${stage} failure`));
    transaction.assertRestored();
  }

  const firstRuntime = runtimeState();
  const installed = await patchHiddenThinkingLayout(
    firstRuntime.timeline,
    firstRuntime.sectionController,
    () => true,
    () => "auto",
  );
  assert.deepEqual(installed, { ok: true });

  const transaction = new FailingStageTransaction("assistant");
  const secondRuntime = runtimeState();
  const failedReload = await patchHiddenThinkingLayout(
    secondRuntime.timeline,
    secondRuntime.sectionController,
    () => true,
    () => "auto",
    { transaction },
  );
  assert.equal(failedReload.ok, false);
  transaction.assertRestored();
});
