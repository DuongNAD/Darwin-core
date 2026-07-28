// Golden master: an exact fingerprint of twelve runs.
//
// This is the safety net for optimisation work. Making the engine faster must
// not change a single creature's position, so any diff here means the model
// changed — either by accident, or deliberately, in which case regenerate with:
//
//   node scripts/make-golden.mjs
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");
const golden = JSON.parse(
  await readFile(new URL("./fixtures/golden-master.json", import.meta.url), "utf8"),
);

function loadEngine() {
  const match = html.match(
    /\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/,
  );
  assert.ok(match, "simulation core marker is present");
  const context = vm.createContext({ console, globalThis: {}, Math, Map, Set, Number });
  vm.runInContext(match[1], context);
  return context.globalThis.DarwinEngine;
}

const GENES = ["speed", "size", "perception", "metabolism", "immunity", "camouflage", "fecundity"];

// Must stay identical to scripts/make-golden.mjs.
function checksum(world) {
  let hash = 0x811c9dc5;
  const feed = (value) => {
    const text = typeof value === "number" ? value.toFixed(9) : String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  feed(world.day); feed(world.tick); feed(world.nextId);
  feed(world.births); feed(world.deaths); feed(world.maxGen);
  for (const c of world.creatures) {
    feed(c.id); feed(c.x); feed(c.y); feed(c.energy); feed(c.age);
    feed(c.gen); feed(c.lineage); feed(c.offspring);
    for (const key of GENES) feed(c.genes[key]);
  }
  for (const f of world.food) { feed(f.x); feed(f.y); }
  return hash.toString(16).padStart(8, "0");
}

test("the fixture covers every scenario and both reproduction modes", () => {
  const engine = loadEngine();
  const covered = new Set(golden.cases.map((c) => c.scenario));
  for (const scenario of Object.keys(engine.SCENARIOS)) {
    assert.ok(covered.has(scenario), `golden master must cover ${scenario}`);
  }
  assert.ok(golden.cases.some((c) => c.sexual), "sexual reproduction must be pinned");
  assert.ok(golden.cases.some((c) => !c.sexual), "asexual reproduction must be pinned");
  assert.ok(golden.cases.some((c) => c.differentiation !== null), "Q_ST must be pinned");
});

for (const expected of golden.cases) {
  const label =
    `${expected.scenario} · seed ${expected.seed} · ${expected.days}d · ` +
    `${expected.sexual ? "sexual" : "asexual"}`;

  test(`reproduces the recorded run: ${label}`, () => {
    const engine = loadEngine();
    const world = new engine.World({
      seed: expected.seed,
      scenario: expected.scenario,
      sexual: expected.sexual,
    });
    world.runTicks(engine.TICKS_PER_DAY * expected.days);

    const stats = world.stats();
    const metrics = world.researchMetrics();

    // Coarse values first: a failure here reads far better than a hash mismatch.
    assert.equal(stats.pop, expected.population, "population");
    assert.equal(world.food.length, expected.food, "food");
    assert.equal(world.births, expected.births, "births");
    assert.equal(world.deaths, expected.deaths, "deaths");
    assert.equal(world.maxGen, expected.maxGen, "max generation");

    for (const gene of GENES) {
      assert.equal(
        Number(stats[gene].toFixed(9)),
        expected.genes[gene],
        `mean ${gene}`,
      );
    }
    assert.equal(
      Number(metrics.geneticDiversity.toFixed(9)),
      expected.geneticDiversity,
      "genetic diversity",
    );
    assert.equal(
      Number(metrics.effectiveLineages.toFixed(9)),
      expected.effectiveLineages,
      "effective lineages",
    );
    assert.equal(
      Number(metrics.meanOffspring.toFixed(9)),
      expected.meanOffspring,
      "mean offspring",
    );
    assert.equal(
      metrics.differentiation ? Number(metrics.differentiation.mean.toFixed(9)) : null,
      expected.differentiation,
      "Q_ST",
    );

    // Then the full state, including every creature position.
    assert.equal(
      checksum(world),
      expected.checksum,
      "full-state checksum: some creature moved, even though the summary matched",
    );
  });
}
