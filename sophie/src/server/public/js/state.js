'use strict';

export function createStore(initial = {}) {
  let value = { ...initial };
  const listeners = new Set();

  return {
    get() {
      return { ...value };
    },
    set(patch = {}) {
      value = { ...value, ...patch };
      listeners.forEach(listener => listener({ ...value }));
      return { ...value };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
