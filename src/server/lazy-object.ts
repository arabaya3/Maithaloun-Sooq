// Defers creation until first use, so importing a module never needs runtime secrets (Next imports every route at build time).
export function lazyObject<T extends object>(create: () => T): T {
  let instance: T | undefined;
  const resolve = () => (instance ??= create());
  return new Proxy({} as T, {
    get(_target, property) {
      const target = resolve();
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, property, value) {
      return Reflect.set(resolve(), property, value);
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve());
    },
  });
}
