import { describe, expect, it, vi } from "vitest";

import { lazyObject } from "./lazy-object";

class Counter {
  count = 0;
  increment() {
    this.count += 1;
    return this.count;
  }
}

describe("lazyObject", () => {
  it("does not create the object until it is used", () => {
    const create = vi.fn(() => {
      throw new Error("Invalid server configuration: DATABASE_URL");
    });
    expect(() => lazyObject(create)).not.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates once and keeps methods bound to the real instance", () => {
    const create = vi.fn(() => new Counter());
    const counter = lazyObject(create);
    const { increment } = counter;
    expect(increment()).toBe(1);
    expect(counter.increment()).toBe(2);
    expect(counter.count).toBe(2);
    expect(counter).toBeInstanceOf(Counter);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
