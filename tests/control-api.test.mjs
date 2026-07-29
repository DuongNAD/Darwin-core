// The control port: a data-only API for reaching into a running population.
// The same surface backs the in-page desk and, later, an MCP server, so it is
// tested on its own rather than through the UI.
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

function makeControl(engine, options = {}) {
  const world = new engine.World({ seed: 5, scenario: "baseline", ...options });
  world.runTicks(engine.TICKS_PER_DAY * 3);
  return { world, control: new engine.Controller(() => world) };
}

test("reads back the state of a running world", () => {
  const engine = loadEngine();
  const { world, control } = makeControl(engine);

  const state = control.state();
  assert.equal(state.scenario, "baseline");
  assert.equal(state.seed, 5);
  assert.equal(state.day, world.day);
  assert.equal(state.population, world.creatures.length);
  assert.equal(state.reproduction, "asexual");
  assert.equal(state.interventions, 0);
  assert.equal(typeof state.geneticDiversity, "number");

  // An MCP server cannot ship class instances, functions or undefined down the
  // wire, so every value the port returns has to be plain data.
  const plain = (value, path) => {
    assert.notEqual(value, undefined, `${path} must not be undefined`);
    assert.ok(typeof value !== "function", `${path} must not be a function`);
    if (value !== null && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) plain(inner, `${path}.${key}`);
    }
  };
  plain(state, "state");
  assert.equal(Object.keys(JSON.parse(JSON.stringify(state))).length, Object.keys(state).length);

  const pool = control.genePool();
  for (const gene of engine.GENE_KEYS) {
    assert.ok(pool[gene].min <= pool[gene].mean && pool[gene].mean <= pool[gene].max, gene);
    assert.equal(pool[gene].range.length, 2);
  }
  assert.equal(control.listCreatures(5).length, 5);
  assert.ok(control.history(2).length <= 2);
});

test("every write is recorded, every read is not", () => {
  const engine = loadEngine();
  const { world, control } = makeControl(engine);

  // Reads leave nothing behind.
  control.state();
  control.genePool();
  control.listCreatures(3);
  control.history(2);
  assert.equal(world.interventions.length, 0, "reads must not be logged");

  control.setGene("speed", 3);
  control.nudgeGene("size", 0.2);
  control.inject({ count: 4 });
  control.cull({ fraction: 0.1 });
  control.addFood(20);
  control.setParam("foodPerDay", 200);

  const log = control.log();
  assert.equal(log.length, 6, "each write leaves exactly one entry");
  // spread into this realm: the engine runs in a vm context with its own
  // Array.prototype, which a strict deep-equal would reject.
  assert.deepEqual(
    [...log].map((entry) => entry.action),
    ["đặt gene", "dịch gene", "tiêm cá thể", "loại bỏ", "thêm thức ăn", "đổi tham số"],
  );
  for (const entry of log) {
    assert.equal(typeof entry.day, "number");
    assert.equal(typeof entry.detail, "string");
  }

  // A meddled-with run must never look like a clean one.
  assert.ok(
    world.eventLog.some((event) => event.type === "intervention"),
    "interventions surface in the event log too",
  );
  const exported = JSON.parse(engine.exportExperiment(world, "json"));
  assert.equal(exported.interventions.length, 6, "the export carries the record");
});

test("gene writes stay inside the declared range", () => {
  const engine = loadEngine();
  const { world, control } = makeControl(engine);

  const [low, high] = engine.RANGE.speed;
  control.setGene("speed", 999);
  assert.ok(world.creatures.every((c) => c.genes.speed === high), "clamped to the ceiling");
  control.setGene("speed", -999);
  assert.ok(world.creatures.every((c) => c.genes.speed === low), "clamped to the floor");

  control.nudgeGene("speed", 999);
  assert.ok(world.creatures.every((c) => c.genes.speed <= high));

  assert.throws(() => control.setGene("nosuchgene", 1), /gene không tồn tại/);
  assert.throws(() => control.setParam("nosuchparam", 1), /tham số không tồn tại/);
});

test("injection and culling move the population as asked", () => {
  const engine = loadEngine();
  const { world, control } = makeControl(engine);

  const before = world.creatures.length;
  const injected = control.inject({ count: 12, genes: { speed: 2.5, size: 1.1 } });
  assert.equal(injected.injected, 12);
  assert.equal(world.creatures.length, before + 12);
  const fresh = world.creatures.slice(-12);
  assert.ok(fresh.every((c) => Math.abs(c.genes.speed - 2.5) < 1e-9), "requested gene applied");
  assert.ok(fresh.every((c) => c.gen === 0), "injected animals start a new lineage");

  // Culling everything is allowed, and the bookkeeping must stay honest.
  const deathsBefore = world.deaths;
  const result = control.cull({ fraction: 1 });
  assert.equal(world.creatures.length, 0);
  assert.equal(result.removed, before + 12);
  assert.equal(world.deaths, deathsBefore + before + 12);

  // Injecting into a dead world falls back to mid-range genes rather than zeros.
  control.inject({ count: 3 });
  for (const creature of world.creatures) {
    for (const gene of engine.GENE_KEYS) {
      const [lo, hi] = engine.RANGE[gene];
      assert.ok(creature.genes[gene] >= lo && creature.genes[gene] <= hi, gene);
    }
  }
});

test("a fraction limits how much of the population is touched", () => {
  const engine = loadEngine();
  const { world, control } = makeControl(engine);
  world.runTicks(engine.TICKS_PER_DAY * 4);
  assert.ok(world.creatures.length > 40, "need a population worth sampling");

  const result = control.setGene("camouflage", 0.5, { fraction: 0.25 });
  assert.ok(result.touched > 0 && result.touched < world.creatures.length,
    `a quarter should be partial, got ${result.touched}/${world.creatures.length}`);
  const changed = world.creatures.filter((c) => c.genes.camouflage === 0.5).length;
  assert.equal(changed, result.touched, "the report matches what actually changed");
});

test("interventions survive save and restore", () => {
  const engine = loadEngine();
  const { world, control } = makeControl(engine);
  control.setGene("speed", 2);
  control.inject({ count: 2 });

  const restored = engine.World.fromSnapshot(world.snapshot());
  assert.equal(restored.interventions.length, 2);
  assert.deepEqual(restored.interventions, world.interventions);
});

test("the page exposes the same port it documents", () => {
  assert.match(html, /globalThis\.DarwinControl=control/);
  assert.match(html, /new Controller\(\(\)=>world\)/);
  for (const id of ["ctlGene", "ctlValue", "ctlFraction", "ctlSet", "ctlInject", "ctlCull", "interventionLog"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
