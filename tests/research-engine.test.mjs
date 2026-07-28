import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadEngine() {
  const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");
  const match = html.match(
    /\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/,
  );
  assert.ok(match, "simulation core marker is present");

  const context = vm.createContext({
    console,
    globalThis: {},
    Math,
    Map,
    Set,
  });
  vm.runInContext(match[1], context);
  return context.globalThis.DarwinEngine;
}

test("offers eight distinct research scenarios", async () => {
  const engine = await loadEngine();
  assert.ok(engine, "DarwinEngine is exposed by the simulation core");

  const expected = [
    "baseline",
    "scarcity",
    "abundance",
    "predator",
    "climate",
    "epidemic",
    "islands",
    "extinction",
  ];
  assert.deepEqual(Object.keys(engine.SCENARIOS), expected);

  for (const scenario of Object.values(engine.SCENARIOS)) {
    assert.equal(typeof scenario.name, "string");
    assert.equal(typeof scenario.hypothesis, "string");
    assert.equal(typeof scenario.params, "object");
  }
});

test("initializes extended genes from the selected research scenario", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 42, scenario: "epidemic" });

  assert.equal(world.scenarioId, "epidemic");
  assert.equal(world.params.epidemic, true);
  assert.equal(world.creatures.length, 45);

  for (const creature of world.creatures) {
    assert.equal(typeof creature.genes.metabolism, "number");
    assert.equal(typeof creature.genes.immunity, "number");
    assert.equal(typeof creature.genes.camouflage, "number");
    assert.equal(typeof creature.genes.fecundity, "number");
  }
});

test("turns camouflage, fecundity, and habitat zones into active mechanisms", async () => {
  const engine = await loadEngine();
  const predator = new engine.World({ seed: 73, scenario: "predator" });
  const lowCamouflage = { genes: { camouflage: 0.1 } };
  const highCamouflage = { genes: { camouflage: 0.9 } };
  assert.ok(
    predator.detectionProbability(highCamouflage) <
      predator.detectionProbability(lowCamouflage),
  );

  const baseline = new engine.World({ seed: 73, scenario: "baseline" });
  const lowFecundity = { genes: { fecundity: 0.7 } };
  const highFecundity = { genes: { fecundity: 1.4 } };
  const lowRequirement = baseline.reproductionRequirement(lowFecundity);
  const highRequirement = baseline.reproductionRequirement(highFecundity);
  assert.ok(highRequirement.food < lowRequirement.food);
  assert.ok(highRequirement.energy < lowRequirement.energy);

  const abundance = new engine.World({ seed: 73, scenario: "abundance" });
  const nutrientFood = abundance.food.filter((food) => {
    const zone = abundance.zoneAt(food.x, food.y);
    return zone?.type === "nutrient";
  });
  assert.ok(
    nutrientFood.length / abundance.food.length > 0.5,
    "abundant resources should form visible nutrient hotspots",
  );
});

test("selected scenarios actively reshape the environment", async () => {
  const engine = await loadEngine();

  const climate = new engine.World({ seed: 17, scenario: "climate" });
  const initialTemperature = climate.environment.temperature;
  climate.runTicks(engine.TICKS_PER_DAY * 5);
  assert.notEqual(climate.environment.temperature, initialTemperature);
  assert.ok(climate.eventLog.some((event) => event.type === "climate"));

  const epidemic = new engine.World({ seed: 17, scenario: "epidemic" });
  epidemic.runTicks(engine.TICKS_PER_DAY * 9);
  assert.ok(epidemic.eventLog.some((event) => event.type === "epidemic"));

  const islands = new engine.World({ seed: 17, scenario: "islands" });
  assert.ok(islands.zones.some((zone) => zone.type === "barrier"));

  const extinction = new engine.World({ seed: 17, scenario: "extinction" });
  extinction.runTicks(engine.TICKS_PER_DAY * 13);
  assert.ok(extinction.eventLog.some((event) => event.type === "extinction"));
});

test("reports research-grade diversity, fitness, lineage, and mortality metrics", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 99, scenario: "baseline" });
  world.runTicks(engine.TICKS_PER_DAY * 3);

  const report = world.researchMetrics();
  assert.equal(report.day, world.day);
  assert.equal(report.population, world.creatures.length);
  assert.equal(typeof report.geneticDiversity, "number");
  // Fitness is lifetime reproductive success over completed lives, and the
  // lineage index is named for what it measures (not population-genetic Ne).
  assert.equal(typeof report.meanOffspring, "number");
  assert.equal(typeof report.completedLives, "number");
  assert.equal(typeof report.effectiveLineages, "number");
  assert.equal(report.meanFitness, undefined);
  assert.equal(report.effectivePopulation, undefined);
  assert.equal(typeof report.meanEnergy, "number");
  assert.equal(typeof report.deathCauses.starve, "number");
  assert.equal(typeof report.selectionDifferential.speed, "number");

  const genes = [
    "speed",
    "size",
    "perception",
    "metabolism",
    "immunity",
    "camouflage",
    "fecundity",
  ];
  assert.deepEqual(Object.keys(report.geneVariance), genes);
  assert.equal(typeof world.scientificConclusion(), "string");
  assert.ok(world.scientificConclusion().length > 40);
});

test("runs a deterministic A/B study and exports reproducible datasets", async () => {
  const engine = await loadEngine();
  const study = new engine.ComparisonStudy({
    seed: 2026,
    scenarioA: "baseline",
    scenarioB: "scarcity",
  });

  study.runTicks(engine.TICKS_PER_DAY * 2);
  const report = study.report();
  assert.equal(report.seed, 2026);
  assert.equal(report.a.scenario, "baseline");
  assert.equal(report.b.scenario, "scarcity");
  assert.equal(typeof report.delta.population, "number");
  assert.equal(typeof report.delta.geneticDiversity, "number");

  const json = engine.exportExperiment(study.a, "json");
  const parsed = JSON.parse(json);
  assert.equal(parsed.meta.seed, 2026);
  assert.equal(parsed.meta.scenario, "baseline");
  assert.ok(Array.isArray(parsed.history));

  const csv = engine.exportExperiment(study.b, "csv");
  assert.match(csv, /^day,population,food,diversity,mean_offspring,energy/m);
  assert.ok(csv.split("\n").length >= 3);
});

test("saves and restores an experiment without changing its future", async () => {
  const engine = await loadEngine();
  const original = new engine.World({ seed: 81, scenario: "climate" });
  original.runTicks(engine.TICKS_PER_DAY * 2 + 37);

  const restored = engine.World.fromSnapshot(original.snapshot());
  assert.equal(restored.day, original.day);
  assert.equal(restored.tick, original.tick);
  assert.deepEqual(restored.researchMetrics(), original.researchMetrics());

  original.runTicks(120);
  restored.runTicks(120);
  assert.deepEqual(restored.researchMetrics(), original.researchMetrics());
  assert.deepEqual(restored.food, original.food);
});
