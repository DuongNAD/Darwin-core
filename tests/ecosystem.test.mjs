// Plants as a producer layer: they grow, they spread, and an over-grazed patch
// has to wait for the next cohort rather than being restocked every morning.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");

function loadEngine() {
  const match = html.match(
    /\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/,
  );
  const context = vm.createContext({ console, globalThis: {}, Math, Map, Set, Number });
  vm.runInContext(match[1], context);
  return context.globalThis.DarwinEngine;
}

test("seedlings ripen over time instead of appearing edible", () => {
  const engine = loadEngine();
  const world = new engine.World({ seed: 5, scenario: "baseline" });

  // The opening cover is mature so day one is not a famine.
  assert.ok(world.food.length > 0);
  assert.ok(world.food.every((plant) => plant.growth === 1), "initial cover starts grown");

  world.food.length = 0;
  world.spawnFood(40);
  assert.ok(world.food.every((plant) => plant.growth === 0), "fresh sowing starts as seed");

  world.growPlants();
  const afterOne = world.food[0].growth;
  assert.ok(afterOne > 0 && afterOne < 1, `one tick is partial growth, got ${afterOne}`);

  for (let i = 0; i < 400; i++) world.growPlants();
  assert.ok(world.food.every((plant) => plant.growth === 1), "growth saturates at 1");
});

test("only grown plants are food", () => {
  const engine = loadEngine();
  const world = new engine.World({ seed: 5, scenario: "baseline" });

  // A single creature sitting on a seedling must not be able to eat it.
  world.food = [{ x: 200, y: 200, growth: 0 }];
  world.creatures = world.creatures.slice(0, 1);
  const creature = world.creatures[0];
  creature.x = 200;
  creature.y = 200;
  creature.energy = 120;

  const before = world.food.length;
  world.step();
  assert.equal(world.food.length, before, "a seedling survives being stood on");

  // The same plant, grown, is eaten.
  world.food = [{ x: creature.x, y: creature.y, growth: 1 }];
  world.step();
  assert.equal(world.food.length, 0, "a grown plant is eaten");
});

test("grown plants seed near themselves, so cover forms patches", () => {
  const engine = loadEngine();
  const world = new engine.World({ seed: 9, scenario: "baseline" });

  world.food = [{ x: 480, y: 300, growth: 1 }];
  let seeded = 0;
  for (let day = 0; day < 60 && seeded === 0; day++) {
    world.seedPlants();
    seeded = world.food.length - 1;
  }
  assert.ok(seeded > 0, "a grown plant eventually seeds");

  for (const plant of world.food.slice(1)) {
    const distance = Math.hypot(plant.x - 480, plant.y - 300);
    assert.ok(distance <= 60, `seed lands near its parent, got ${distance.toFixed(1)}`);
    assert.equal(plant.growth, 0, "offspring start as seed");
  }
});

test("the barrier stops seeds as well as animals", () => {
  const engine = loadEngine();
  const world = new engine.World({ seed: 9, scenario: "islands" });

  // Park a grown plant right against the barrier and let it seed repeatedly.
  world.food = [{ x: world.W * 0.47 - 6, y: 300, growth: 1 }];
  for (let day = 0; day < 200; day++) world.seedPlants();

  const inBarrier = world.food.filter(
    (plant) => plant.x > world.W * 0.47 && plant.x < world.W * 0.53,
  );
  assert.equal(inBarrier.length, 0, "no seed may land inside the barrier");
});

test("grazing pressure leaves a real mix of seedlings and grown cover", () => {
  const engine = loadEngine();
  const world = new engine.World({ seed: 11, scenario: "baseline" });
  world.runTicks(engine.TICKS_PER_DAY * 30);

  assert.ok(world.creatures.length > 0, "the population should survive on plants");
  const grown = world.food.filter((plant) => plant.growth >= 1).length;
  const share = grown / Math.max(1, world.food.length);

  // Both failure modes matter. All-grown means grazing never bites; none-grown
  // means the cohort is eaten before it ripens and the mechanism is inert —
  // the first design failed exactly that way, at 0% grown.
  assert.ok(share > 0.05, `some cover must reach maturity (${(share * 100).toFixed(0)}%)`);
  assert.ok(share < 0.95, `grazing must bite (${(share * 100).toFixed(0)}%)`);
});

test("plants survive save and restore", () => {
  const engine = loadEngine();
  const world = new engine.World({ seed: 5, scenario: "baseline" });
  world.runTicks(engine.TICKS_PER_DAY * 4);

  const restored = engine.World.fromSnapshot(world.snapshot());
  assert.equal(restored.food.length, world.food.length);
  for (let i = 0; i < world.food.length; i++) {
    assert.equal(restored.food[i].growth, world.food[i].growth, `plant ${i} keeps its growth`);
  }
});
