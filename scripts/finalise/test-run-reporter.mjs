import { writeFileSync } from "node:fs";
import path from "node:path";

// The runner accepts this report only after a normal CLI exit with matching status.
export default class FinaliseReporter {
  onTestRunStart(specifications) {
    this.expected = specifications.map(spec => path.relative(process.cwd(), spec.moduleId).split(path.sep).join("/"));
  }

  onTestRunEnd(modules, errors, reason) {
    if (errors.length || reason === "interrupted") return;
    const states = {};
    for (const testModule of modules) {
      const name = path.relative(process.cwd(), testModule.moduleId).split(path.sep).join("/");
      const state = testModule.state();
      if (Object.hasOwn(states, name) || !["passed", "skipped", "failed"].includes(state)) return;
      states[name] = state;
    }
    if (!this.expected?.length || new Set(this.expected).size !== this.expected.length ||
        Object.keys(states).length !== this.expected.length || this.expected.some(name => !Object.hasOwn(states, name))) return;
    writeFileSync(process.env.FINALISE_VITEST_REPORT, JSON.stringify({ states, reason }));
  }
}
