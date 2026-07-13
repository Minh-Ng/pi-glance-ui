export class PatchTransaction {
  constructor() {
    this.snapshots = [];
    this.captured = new WeakMap();
  }

  capture(target, ...properties) {
    let capturedProperties = this.captured.get(target);
    if (!capturedProperties) {
      capturedProperties = new Set();
      this.captured.set(target, capturedProperties);
    }
    for (const property of properties.flat()) {
      if (capturedProperties.has(property)) continue;
      capturedProperties.add(property);
      this.snapshots.push({
        target,
        property,
        descriptor: Object.getOwnPropertyDescriptor(target, property),
      });
    }
  }

  checkpoint(_stage) {}

  rollback() {
    for (let index = this.snapshots.length - 1; index >= 0; index -= 1) {
      const { target, property, descriptor } = this.snapshots[index];
      if (descriptor) Object.defineProperty(target, property, descriptor);
      else delete target[property];
    }
    this.snapshots.length = 0;
    this.captured = new WeakMap();
  }

  commit() {
    this.snapshots.length = 0;
    this.captured = new WeakMap();
  }
}

export async function runPatchTransaction(install) {
  const transaction = new PatchTransaction();
  try {
    const result = await install(transaction);
    transaction.commit();
    return result;
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}
