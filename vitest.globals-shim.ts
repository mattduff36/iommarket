import {
  expect as importedExpect,
  vi as importedVi,
  vitest as importedVitest,
} from "./node_modules/vitest/dist/index.js";

type SuiteApi = typeof import("vitest").describe;

type VitestGlobals = typeof globalThis & {
  describe: SuiteApi;
  it: SuiteApi;
  test: SuiteApi;
  suite: SuiteApi;
  beforeAll: typeof import("vitest").beforeAll;
  beforeEach: typeof import("vitest").beforeEach;
  afterAll: typeof import("vitest").afterAll;
  afterEach: typeof import("vitest").afterEach;
  onTestFailed: typeof import("vitest").onTestFailed;
  onTestFinished: typeof import("vitest").onTestFinished;
};

const globals = globalThis as VitestGlobals;

function fromGlobal<K extends keyof VitestGlobals>(name: K): VitestGlobals[K] {
  const value = globals[name];
  if (value == null) {
    throw new Error(`Vitest global "${String(name)}" is not available. Enable test.globals.`);
  }
  return value;
}

function bindGlobal<K extends keyof VitestGlobals>(name: K): VitestGlobals[K] {
  return new Proxy(function boundGlobal() {}, {
    apply(_target, _thisArg, args) {
      const real = fromGlobal(name) as (...fnArgs: unknown[]) => unknown;
      return Reflect.apply(real, real, args);
    },
    get(_target, property) {
      const real = fromGlobal(name) as object;
      const value = Reflect.get(real, property, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
  }) as unknown as VitestGlobals[K];
}

export const describe = bindGlobal("describe");
export const it = bindGlobal("it");
export const test = bindGlobal("test");
export const suite = bindGlobal("suite");
export const beforeAll = bindGlobal("beforeAll");
export const beforeEach = bindGlobal("beforeEach");
export const afterAll = bindGlobal("afterAll");
export const afterEach = bindGlobal("afterEach");
export const onTestFailed = bindGlobal("onTestFailed");
export const onTestFinished = bindGlobal("onTestFinished");
export const expect = importedExpect;
export const vi = importedVi;
export const vitest = importedVitest;
