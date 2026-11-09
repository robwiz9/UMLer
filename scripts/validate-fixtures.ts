import { STEP1_FIXTURES } from "../src/fixtures/index.ts";
import { validateScene, type Diagnostic } from "../src/model/validate.ts";

const format = (diagnostic: Diagnostic): string =>
  `[${diagnostic.severity}] ${diagnostic.code} at ${diagnostic.path}: ${diagnostic.message}`;

let errors = 0;
let warnings = 0;

for (const fixture of STEP1_FIXTURES) {
  const diagnostics = validateScene(fixture.scene);
  const fixtureErrors = diagnostics.filter((d) => d.severity === "error").length;
  const fixtureWarnings = diagnostics.length - fixtureErrors;
  errors += fixtureErrors;
  warnings += fixtureWarnings;

  const nodeCount = Object.keys(fixture.scene.nodes).length;
  const edgeCount = Object.keys(fixture.scene.edges).length;
  console.log(
    `${fixtureErrors === 0 ? "PASS" : "FAIL"} ${fixture.name} — ${nodeCount} nodes, ${edgeCount} edges, ${fixtureErrors} errors, ${fixtureWarnings} warnings`,
  );

  for (const diagnostic of diagnostics) {
    console.log(`  ${format(diagnostic)}`);
  }
}

console.log(`\n${errors} errors, ${warnings} warnings across ${STEP1_FIXTURES.length} fixtures`);
if (errors > 0) process.exitCode = 1;
