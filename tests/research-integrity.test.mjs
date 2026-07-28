// Regression tests for the simulation-integrity fixes (Tier 1).
// Each test pins one defect that made the lab's numbers untrustworthy.
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

  const context = vm.createContext({ console, globalThis: {}, Math, Map, Set });
  vm.runInContext(match[1], context);
  return context.globalThis.DarwinEngine;
}

const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");

test("a seed reproduces the same run regardless of browser window size", async () => {
  const engine = await loadEngine();

  // The world owns a fixed logical arena; only the renderer scales.
  const world = new engine.World({ seed: 12345, scenario: "baseline" });
  assert.equal(world.W, engine.SIM_WIDTH);
  assert.equal(world.H, engine.SIM_HEIGHT);

  const runs = [0, 1].map(() => {
    const w = new engine.World({ seed: 12345, scenario: "baseline" });
    w.runTicks(engine.TICKS_PER_DAY * 12);
    return w.stats();
  });
  assert.deepEqual(runs[0], runs[1]);

  // The UI must never resize a world to match the canvas.
  assert.doesNotMatch(html, /resizeWorld/);
  assert.match(html, /function viewport\(/);
  assert.match(html, /new World\(\{seed,scenario:scenarioA\}\)/);
});

test("reproduction at the population cap is not decided by array index", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 909, scenario: "abundance" });
  world.runTicks(engine.TICKS_PER_DAY * 30);

  // Put the world just under the cap with every creature ready to breed, so the
  // scarce slots must be handed out by the allocation rule and nothing else.
  world.creatures = world.creatures.filter((c) => c.alive).slice(0, 400);
  assert.ok(
    world.creatures.length >= 300,
    `need a crowded population to test the cap (got ${world.creatures.length})`,
  );
  for (const creature of world.creatures) {
    creature.eaten = 5;
    creature.energy = creature.maxEnergy;
  }

  const size = world.creatures.length;
  const indexById = new Map(world.creatures.map((c, i) => [c.id, i]));
  const before = world.creatures.map((c) => c.offspring);
  world.step();

  const winners = [];
  for (const creature of world.creatures) {
    const index = indexById.get(creature.id);
    if (index === undefined) continue;
    if (creature.offspring > before[index]) winners.push(index);
  }

  // Capacity is HARD_CAP - alive, far fewer than the 400 eligible parents.
  assert.ok(winners.length > 10, `the cap should still allow births (${winners.length})`);
  assert.ok(winners.length < size, "not everyone can breed at the cap");

  const lastQuarter = winners.filter((i) => i > size * 0.75).length;
  const firstQuarter = winners.filter((i) => i < size * 0.25).length;
  assert.ok(
    lastQuarter > 0 && firstQuarter > 0,
    `slots must reach both ends of the array (first=${firstQuarter}, last=${lastQuarter})`,
  );
  // A uniform draw puts ~25% of winners in the final quarter; the old `break`
  // put exactly 0 there. Allow a wide band, reject the degenerate case.
  const share = lastQuarter / winners.length;
  assert.ok(
    share > 0.1,
    `winners must not cluster at the front of the array (last quarter got ${(share * 100).toFixed(0)}%)`,
  );
});

test("visit order is shuffled per tick so nobody always eats first", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 4242, scenario: "baseline" });

  const first = [...world.visitOrder(60)];
  const second = [...world.visitOrder(60)];
  assert.equal(first.length, 60);
  assert.deepEqual([...first].sort((a, b) => a - b), [...Array(60).keys()]);
  assert.notDeepEqual(first, second, "each tick must draw a fresh order");
  assert.notDeepEqual(first, [...Array(60).keys()], "order must not be the identity");

  // Behavioural check: front and back of the array fare comparably.
  world.runTicks(engine.TICKS_PER_DAY * 6);
  const size = world.creatures.length;
  const snapshot = world.creatures.map((c) => ({ id: c.id, energy: c.energy }));
  const indexById = new Map(snapshot.map((c, i) => [c.id, i]));
  world.runTicks(engine.TICKS_PER_DAY);

  let frontSum = 0;
  let frontCount = 0;
  let backSum = 0;
  let backCount = 0;
  for (const creature of world.creatures) {
    const index = indexById.get(creature.id);
    if (index === undefined) continue;
    const delta = creature.energy - snapshot[index].energy;
    if (index < size / 2) {
      frontSum += delta;
      frontCount++;
    } else {
      backSum += delta;
      backCount++;
    }
  }
  const front = frontSum / Math.max(1, frontCount);
  const back = backSum / Math.max(1, backCount);
  assert.ok(
    Math.abs(front - back) < 6,
    `array halves should fare alike (front=${front.toFixed(2)}, back=${back.toFixed(2)})`,
  );
});

test("metabolism buys cheap energy with a shorter life, as the legend claims", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 5, scenario: "baseline" });

  const fast = world.lifespanTicks({ size: 1, metabolism: 1.5 });
  const slow = world.lifespanTicks({ size: 1, metabolism: 0.7 });
  assert.ok(fast < slow, "a faster metabolism must shorten lifespan");

  const bigger = world.lifespanTicks({ size: 2, metabolism: 1 });
  const smaller = world.lifespanTicks({ size: 1, metabolism: 1 });
  assert.ok(bigger > smaller, "size still extends lifespan");

  const [lo, hi] = engine.RANGE.metabolism;
  const span =
    world.lifespanTicks({ size: 1, metabolism: lo }) /
    world.lifespanTicks({ size: 1, metabolism: hi });
  assert.ok(span > 2.5, `lifespan should vary strongly across the gene range (${span.toFixed(1)}x)`);
});

test("metabolism has an optimum inside its range, not at the ceiling", async () => {
  const engine = await loadEngine();

  // The energy budget splits into a part that gets cheaper with a fast
  // metabolism and a part that gets dearer, so the best value sits in the
  // middle and depends on the rest of the genome. The old single-term model
  // divided every cost by metabolism, so the gene simply climbed to the cap.
  const position = (value) =>
    (value - engine.RANGE.metabolism[0]) /
    (engine.RANGE.metabolism[1] - engine.RANGE.metabolism[0]);

  const settled = {};
  for (const scenario of ["baseline", "abundance", "scarcity"]) {
    const values = [];
    for (const seed of [11, 22]) {
      const w = new engine.World({ seed, scenario });
      w.runTicks(engine.TICKS_PER_DAY * 45);
      if (w.creatures.length) values.push(position(w.stats().metabolism));
    }
    assert.ok(values.length, `${scenario} should not go extinct`);
    settled[scenario] = values.reduce((a, b) => a + b, 0) / values.length;
  }

  for (const [scenario, value] of Object.entries(settled)) {
    assert.ok(
      value > 0.05 && value < 0.8,
      `${scenario} should settle inside the range, not on an edge (${(value * 100).toFixed(0)}%)`,
    );
  }

  // Different environments must favour different metabolic strategies; a single
  // universally-best value would mean the trade-off still is not biting.
  const spread = Math.max(...Object.values(settled)) - Math.min(...Object.values(settled));
  assert.ok(
    spread > 0.2,
    `scenarios should select different strategies (spread ${(spread * 100).toFixed(0)}%)`,
  );
  assert.ok(
    settled.abundance < settled.scarcity,
    "plentiful food should favour a thriftier metabolism than scarcity does",
  );
});

test("fecundity trades earlier breeding for weaker offspring", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 5, scenario: "baseline" });

  const low = world.reproductionRequirement({ genes: { fecundity: 0.65 } });
  const mid = world.reproductionRequirement({ genes: { fecundity: 1.0 } });
  const high = world.reproductionRequirement({ genes: { fecundity: 1.45 } });

  assert.ok(high.food < low.food, "high fecundity breeds on less food");
  assert.ok(high.energy < low.energy, "high fecundity breeds at lower energy");
  assert.ok(
    high.childEnergy < mid.childEnergy && mid.childEnergy < low.childEnergy,
    `child energy must fall as fecundity rises (${low.childEnergy} -> ${high.childEnergy})`,
  );
});

test("A/B mode locks the shared environment controls", () => {
  // The sliders only ever wrote to world A; in compare mode that silently
  // confounded the experiment. They are disabled and the contrast is shown.
  assert.match(html, /id="paramContrast"/);
  assert.match(html, /function syncParamLock\(/);
  assert.match(html, /\['rFood','rMut','rCost','chkPred'\]\) \$\('#'\+id\)\.disabled=locked/);
  assert.match(html, /Chế độ đối chứng/);
});

test("the predation tooltip matches the rule in the engine", async () => {
  const engine = await loadEngine();
  const source = html.match(
    /\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/,
  )[1];
  const rule = source.match(/g\.size < o\.genes\.size\*([\d.]+)/);
  assert.ok(rule, "predation size rule is present");

  const advertised = html.match(/lớn hơn đối thủ ít nhất (\d+)%/);
  assert.ok(advertised, "predation tooltip states a threshold");
  assert.equal(
    Number(advertised[1]),
    Math.round((Number(rule[1]) - 1) * 100),
    "tooltip and engine must state the same size advantage",
  );
  assert.ok(engine.SCENARIOS.predator.params.predation);
});

test("history and CSV carry all seven genes, not just the first three", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 5, scenario: "baseline" });
  world.runTicks(engine.TICKS_PER_DAY * 4);

  const row = world.history.at(-1);
  for (const gene of [
    "speed", "size", "perception",
    "metabolism", "immunity", "camouflage", "fecundity",
  ]) {
    assert.equal(typeof row[gene], "number", `history should record ${gene}`);
  }
  assert.equal(typeof row.selection.speed, "number");

  const csv = engine.exportExperiment(world, "csv");
  const header = csv.split("\n")[0].split(",");
  for (const column of ["metabolism", "immunity", "camouflage", "fecundity", "effective_lineages"]) {
    assert.ok(header.includes(column), `CSV should export ${column}`);
  }
  const cells = csv.split("\n")[1].split(",");
  assert.equal(cells.length, header.length, "every column must have a value");
});

test("summary statistics match hand-computed values", async () => {
  const engine = await loadEngine();

  const summary = engine.summarize([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(summary.n, 8);
  assert.equal(summary.mean, 5);
  assert.ok(Math.abs(summary.sd - 2.13809) < 1e-4, `sample sd was ${summary.sd}`);
  // 95% CI must use the t distribution: t(df=7) = 2.365, not z = 1.96.
  const t = summary.ci / (summary.sd / Math.sqrt(summary.n));
  assert.ok(Math.abs(t - 2.365) < 1e-3, `t critical was ${t}`);

  const single = engine.summarize([4]);
  assert.equal(single.n, 1);
  assert.ok(!Number.isFinite(single.ci), "one replicate cannot have a CI");
  assert.equal(engine.summarize([]).n, 0);
});

test("A/B differences are only called significant when the CI excludes zero", async () => {
  const engine = await loadEngine();

  const apart = engine.welchDifference([10, 11, 9, 10, 12, 11], [20, 22, 19, 21, 23, 20]);
  assert.ok(apart.significant, "clearly separated groups should be flagged");
  assert.ok(apart.low > 0 && apart.high > 0, "CI should sit entirely above zero");

  const overlapping = engine.welchDifference([10, 11, 9, 10, 12, 11], [10, 12, 9, 11, 11, 10]);
  assert.ok(!overlapping.significant, "overlapping groups must not be flagged");
  assert.ok(overlapping.low < 0 && overlapping.high > 0, "CI should straddle zero");

  const tooFew = engine.welchDifference([10], [20]);
  assert.ok(!tooFew.significant, "a single replicate per arm proves nothing");

  // One arm may lack a metric entirely (Q_ST without a barrier); the table must
  // print a dash rather than "NaN".
  const missing = engine.welchDifference([Number.NaN, Number.NaN], [0.1, 0.2]);
  assert.ok(!Number.isFinite(missing.difference));
  assert.ok(!missing.significant);
  assert.match(html, /if\(!Number\.isFinite\(delta\.difference\)\) return '—';/);
});

test("replicates use independent seeds and aggregate into intervals", async () => {
  const engine = await loadEngine();
  const progress = [];
  const results = engine.runReplicates("baseline", {
    seed: 4242,
    replicates: 4,
    days: 6,
    onProgress: (done, total) => progress.push(`${done}/${total}`),
  });

  assert.equal(results.length, 4);
  assert.deepEqual(progress, ["1/4", "2/4", "3/4", "4/4"]);
  const populations = new Set(results.map((r) => r.population));
  assert.ok(populations.size > 1, "different seeds must give different runs");

  const aggregate = engine.aggregateReplicates(results);
  assert.equal(aggregate.replicates, 4);
  assert.equal(typeof aggregate.extinctions, "number");
  for (const [key] of engine.REPLICATE_FIELDS) {
    // Q_ST has no meaning without isolated subpopulations, so baseline reports
    // nothing rather than a fabricated zero.
    if (key === "differentiation") continue;
    assert.equal(aggregate.fields[key].n, 4, `${key} should aggregate every replicate`);
    assert.ok(Number.isFinite(aggregate.fields[key].mean));
  }
  assert.equal(
    aggregate.fields.differentiation.n,
    0,
    "baseline has no subpopulations, so differentiation must stay empty",
  );

  const islands = engine.aggregateReplicates(
    engine.runReplicates("islands", { seed: 4242, replicates: 3, days: 6 }),
  );
  assert.equal(islands.fields.differentiation.n, 3, "islands must report differentiation");
  assert.ok(Number.isFinite(islands.fields.differentiation.mean));
});

test("a dead population contributes no trait measurements", async () => {
  const engine = await loadEngine();

  // stats() returns 0 for every gene when nobody is left. Folding those zeros
  // into a trait mean mixes "the population died" with "this gene is low",
  // dragging the mean down and inflating the variance.
  const world = new engine.World({ seed: 5, scenario: "baseline" });
  world.runTicks(engine.TICKS_PER_DAY * 3);
  world.creatures = [];

  const summary = engine.replicateStudy(world);
  assert.equal(summary.extinct, true);
  assert.equal(summary.population, 0, "population zero is a real measurement");
  for (const gene of [
    "speed", "size", "perception",
    "metabolism", "immunity", "camouflage", "fecundity",
    "geneticDiversity", "effectiveLineages",
  ]) {
    assert.ok(
      Number.isNaN(summary[gene]),
      `${gene} must not report a value for a dead population (got ${summary[gene]})`,
    );
  }

  // Aggregation keeps counting extinctions while ignoring their fake zeros.
  const survivor = engine.replicateStudy(
    (() => {
      const w = new engine.World({ seed: 7, scenario: "baseline" });
      w.runTicks(engine.TICKS_PER_DAY * 3);
      return w;
    })(),
  );
  const aggregate = engine.aggregateReplicates([summary, survivor, survivor]);
  assert.equal(aggregate.replicates, 3);
  assert.equal(aggregate.extinctions, 1);
  assert.equal(aggregate.fields.population.n, 3, "population counts every replicate");
  assert.equal(aggregate.fields.speed.n, 2, "speed counts only the live ones");
  assert.ok(Math.abs(aggregate.fields.speed.mean - survivor.speed) < 1e-9);
});

test("selection differentials are measured over a closed day, not an empty window", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 31, scenario: "scarcity" });
  world.runTicks(engine.TICKS_PER_DAY * 20);

  // The per-day counters are cleared at each day boundary; the reported value
  // must be the one captured just before that reset, not the empty window.
  const differentials = world.researchMetrics().selectionDifferential;
  const magnitudes = Object.values(differentials).map(Math.abs);
  assert.ok(
    magnitudes.some((value) => value > 0),
    "a running population under selection should show a non-zero differential",
  );
  for (const creature of world.creatures) {
    assert.equal(creature.offspringToday, 0, "the day counter resets after capture");
  }
});

test("the engine lives in its own script tag so the worker reuses it", () => {
  assert.match(html, /<script id="simCore">/);
  // The worker is built from that exact element, not from a second copy.
  assert.match(html, /getElementById\('simCore'\)\.textContent/);
  assert.match(html, /new Worker\(url\)/);
  // And there is a fallback for contexts where blob workers are blocked.
  assert.match(html, /setTimeout\(runOne,0\)/);
  assert.match(html, /id="replicateTable"/);
});

test("recombination draws each gene from one of the two parents", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 1 });

  const mother = { speed: 1, size: 1, perception: 10, metabolism: 0.8, immunity: 0, camouflage: 0, fecundity: 0.8 };
  const father = { speed: 3, size: 2, perception: 90, metabolism: 1.4, immunity: 1, camouflage: 1, fecundity: 1.3 };

  const contributions = { mother: 0, father: 0 };
  for (let i = 0; i < 200; i++) {
    const child = world.recombine(mother, father);
    for (const key of Object.keys(mother)) {
      assert.ok(
        child[key] === mother[key] || child[key] === father[key],
        `${key} must come from a parent, got ${child[key]}`,
      );
      if (child[key] === mother[key]) contributions.mother++;
      else contributions.father++;
    }
  }
  // Free assortment: both parents contribute, and no gene is fixed to one side.
  assert.ok(contributions.mother > 400 && contributions.father > 400, JSON.stringify(contributions));
});

test("sexual reproduction produces offspring carrying both parents' genes", async () => {
  const engine = await loadEngine();

  const sexual = new engine.World({ seed: 77, scenario: "baseline", sexual: true });
  assert.equal(sexual.params.sexual, true);
  sexual.runTicks(engine.TICKS_PER_DAY * 10);

  const withTwoParents = sexual.creatures.filter((c) => c.otherParentId !== null);
  assert.ok(withTwoParents.length > 0, "sexual mode must record a second parent");

  // Asexual stays a clone-with-mutation: there is no second parent at all.
  const asexual = new engine.World({ seed: 77, scenario: "baseline" });
  assert.equal(asexual.params.sexual, false);
  asexual.runTicks(engine.TICKS_PER_DAY * 10);
  assert.ok(
    asexual.creatures.every((c) => c.otherParentId === null),
    "asexual mode must never record a second parent",
  );

  // Needing a mate must not quietly wipe populations out.
  for (const scenario of ["baseline", "predator", "islands"]) {
    const world = new engine.World({ seed: 22, scenario, sexual: true });
    world.runTicks(engine.TICKS_PER_DAY * 30);
    assert.ok(world.creatures.length > 0, `${scenario} should survive under sexual reproduction`);
  }
});

test("Q_ST measures divergence only where subpopulations exist", async () => {
  const engine = await loadEngine();

  // No barrier, no subpopulations, no fabricated number.
  const baseline = new engine.World({ seed: 17, scenario: "baseline" });
  baseline.runTicks(engine.TICKS_PER_DAY * 3);
  assert.equal(baseline.subpopulations(), null);
  assert.equal(baseline.differentiation(), null);
  assert.equal(baseline.researchMetrics().differentiation, null);

  const islands = new engine.World({ seed: 17, scenario: "islands" });
  islands.runTicks(engine.TICKS_PER_DAY * 3);
  const groups = islands.subpopulations();
  assert.equal(groups.length, 2, "the barrier splits the arena in two");
  assert.ok(groups[0].length > 1 && groups[1].length > 1);

  // Identical islands must read as no differentiation.
  for (const group of groups) for (const creature of group) creature.genes.speed = 2;
  assert.ok(islands.differentiation().perGene.speed < 1e-9, "identical islands => Q_ST 0");

  // Fully separated trait values must read as complete differentiation.
  for (const creature of groups[0]) creature.genes.speed = 1;
  for (const creature of groups[1]) creature.genes.speed = 3;
  assert.ok(islands.differentiation().perGene.speed > 0.9, "disjoint islands => Q_ST near 1");

  const report = islands.differentiation();
  assert.ok(report.mean >= 0 && report.mean <= 1, "Q_ST is bounded to [0, 1]");
  // spread into this realm: the engine runs in a vm context, so its arrays
  // carry a different Array.prototype and would fail a strict deep-equal.
  assert.deepEqual([...report.sizes], [groups[0].length, groups[1].length]);
  assert.ok(islands.history.at(-1).differentiation !== undefined, "history tracks divergence");
});

test("the two islands select different foraging strategies", async () => {
  const engine = await loadEngine();

  // Equal food on both sides, clustered on A and scattered on B. With
  // identical islands only drift separated them, and drift is far too weak at
  // this population size — the scenario never did what its hypothesis claimed.
  const runs = [];
  for (const seed of [11, 22, 33, 44, 55]) {
    const world = new engine.World({ seed, scenario: "islands" });
    world.runTicks(engine.TICKS_PER_DAY * 45);
    const report = world.researchMetrics().differentiation;
    assert.ok(report, `seed ${seed} must keep both islands populated`);
    assert.ok(report.sizes[0] > 5 && report.sizes[1] > 5,
      `neither island may collapse (got ${report.sizes.join(" vs ")})`);
    runs.push(report);
  }

  const summary = engine.summarize(runs.map((r) => r.mean));
  assert.ok(
    summary.low > 0.1,
    `divergence must be unambiguous, not drift (Q_ST ${summary.mean.toFixed(3)} ± ${summary.ci.toFixed(3)})`,
  );

  // The split should show up in foraging traits, not spread evenly by chance.
  const perGene = {};
  for (const run of runs) {
    for (const [gene, value] of Object.entries(run.perGene)) {
      perGene[gene] = (perGene[gene] || 0) + value / runs.length;
    }
  }
  const ranked = Object.entries(perGene).sort((a, b) => b[1] - a[1]);
  assert.ok(
    ["speed", "perception", "metabolism"].includes(ranked[0][0]),
    `a foraging trait should diverge most, got ${ranked[0][0]}`,
  );

  // A scenario without a barrier must still report nothing.
  const baseline = new engine.World({ seed: 11, scenario: "baseline" });
  baseline.runTicks(engine.TICKS_PER_DAY * 10);
  assert.equal(baseline.researchMetrics().differentiation, null);
});

test("reproduction mode is a study-level variable applied to both arms", () => {
  // Same rule as the environment sliders: anything that changes the mechanism
  // must reach A and B together, or the comparison is confounded again.
  assert.match(html, /id="chkSexual"/);
  assert.match(html, /world=new World\(\{seed,scenario:scenarioA,sexual:sexualMode\}\)/);
  assert.match(html, /worldB=compareMode\?new World\(\{seed,scenario:scenarioB,sexual:sexualMode\}\)/);
  // and it reaches the replicate runner too, in both the worker and the fallback
  assert.match(html, /sexual:sexualMode\}\)/);
  assert.match(html, /sexual:data\.sexual/);
});

test("perception does not wrap around the arena edges", async () => {
  const engine = await loadEngine();
  const world = new engine.World({ seed: 1, scenario: "baseline" });

  // One item at the far right of the top row. A cell index of gy*cols + gx
  // with gx = -1 lands on (gy-1)*cols + (cols-1) — this very cell — so an
  // unclamped query from the left edge one row down used to find it.
  world.food = [{ x: world.W - 20, y: 10 }];
  const grid = world.buildGrid(world.food, 48);
  assert.equal(grid.cols, Math.ceil(world.W / 48));
  assert.equal(grid.rows, Math.ceil(world.H / 48));

  const out = [];
  world.query(grid, 10, 60, 30, out);
  assert.deepEqual([...out], [], "the left edge must not see the right edge of the row above");

  // The same query still finds something genuinely close by.
  world.food = [{ x: 14, y: 55 }];
  world.query(world.buildGrid(world.food, 48), 10, 60, 30, out);
  assert.equal(out.length, 1, "a nearby item must still be found");

  // And an item at the far side of the arena is never reachable.
  world.food = [{ x: world.W - 20, y: 60 }];
  world.query(world.buildGrid(world.food, 48), 10, 60, 30, out);
  assert.deepEqual([...out], [], "the far side of the arena is out of range");
});

test("the artifact carries no disabled dead code", () => {
  // An entire earlier UI used to sit in the file behind `if(false){ … }`,
  // shipped to every visitor and invisible to every test.
  assert.doesNotMatch(html, /if\s*\(\s*false\s*\)/);
  assert.equal((html.match(/function researchUI\(/g) ?? []).length, 1);
  // One engine definition, one UI definition.
  assert.equal((html.match(/class World\b/g) ?? []).length, 1);
  assert.equal((html.match(/<script/g) ?? []).length, 2);
});

test("the interface is reachable without sight", () => {
  // Both canvases are pure pixels, so each needs a text alternative.
  assert.match(html, /<canvas id="arena" role="img" aria-label=/);
  assert.match(html, /<canvas id="researchChart"[^>]*role="img"[^>]*aria-label=/);
  // and the arena's label must track the live state, not stay a fixed string
  assert.match(html, /arena\.setAttribute\('aria-label',/);

  // Every range control needs a programmatic label.
  const ranges = [...html.matchAll(/<input type="range" id="(\w+)"/g)].map((m) => m[1]);
  assert.ok(ranges.length >= 5, `expected the full control set, saw ${ranges.length}`);
  for (const id of ranges) {
    const labelled =
      new RegExp(`<label for="${id}"`).test(html) ||
      new RegExp(`<input type="range" id="${id}"[^>]*aria-label=`).test(html);
    assert.ok(labelled, `range control ${id} has no associated label`);
  }

  assert.match(html, /<meta name="description" content="[^"]{40,}"/);
  assert.match(html, /<html lang="vi">/);
});

test("there is a single source of truth for the simulation artifact", async () => {
  // The lab used to live in two byte-identical 80 KB files, and the tests read
  // the copy that was never deployed. Now there is only the deployed file.
  const { readdir } = await import("node:fs/promises");
  const root = await readdir(new URL("../", import.meta.url));
  const strays = root.filter((name) => name.endsWith(".html"));
  assert.deepEqual(
    [...strays],
    [],
    `simulation HTML must live only in public/: found ${strays.join(", ")}`,
  );
});
