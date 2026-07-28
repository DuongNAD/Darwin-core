// Sinh golden master: chữ ký chính xác của một loạt bản chạy. Bất kỳ tối ưu nào
// cũng phải giữ nguyên các chữ ký này — tối ưu mà đổi kết quả là đổi mô hình.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");
const src = html.match(/\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/)[1];
const ctx = vm.createContext({ console, globalThis: {}, Math, Map, Set, Number });
vm.runInContext(src, ctx);
const E = ctx.globalThis.DarwinEngine;

// FNV-1a trên trạng thái đầy đủ: bắt được cả vị trí lẫn gene, không chỉ số tổng hợp.
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
    for (const key of ["speed", "size", "perception", "metabolism", "immunity", "camouflage", "fecundity"]) {
      feed(c.genes[key]);
    }
  }
  for (const f of world.food) { feed(f.x); feed(f.y); }
  return hash.toString(16).padStart(8, "0");
}

const CASES = [];
for (const scenario of Object.keys(E.SCENARIOS)) {
  CASES.push({ scenario, seed: 20260728, days: 25, sexual: false });
}
CASES.push({ scenario: "baseline", seed: 4242, days: 30, sexual: true });
CASES.push({ scenario: "islands", seed: 17, seedNote: "Q_ST", days: 30, sexual: true });
CASES.push({ scenario: "predator", seed: 99, days: 20, sexual: true });
CASES.push({ scenario: "abundance", seed: 909, days: 35, sexual: false });

const cases = [];
for (const spec of CASES) {
  const world = new E.World({ seed: spec.seed, scenario: spec.scenario, sexual: spec.sexual });
  world.runTicks(E.TICKS_PER_DAY * spec.days);
  const stats = world.stats();
  const metrics = world.researchMetrics();
  cases.push({
    scenario: spec.scenario,
    seed: spec.seed,
    days: spec.days,
    sexual: spec.sexual,
    checksum: checksum(world),
    population: stats.pop,
    food: world.food.length,
    births: world.births,
    deaths: world.deaths,
    maxGen: world.maxGen,
    genes: Object.fromEntries(
      ["speed", "size", "perception", "metabolism", "immunity", "camouflage", "fecundity"]
        .map((k) => [k, Number(stats[k].toFixed(9))]),
    ),
    geneticDiversity: Number(metrics.geneticDiversity.toFixed(9)),
    effectiveLineages: Number(metrics.effectiveLineages.toFixed(9)),
    meanOffspring: Number(metrics.meanOffspring.toFixed(9)),
    differentiation: metrics.differentiation ? Number(metrics.differentiation.mean.toFixed(9)) : null,
  });
  process.stdout.write(
    `${spec.scenario.padEnd(11)} seed ${String(spec.seed).padStart(8)} ${spec.days}d ` +
    `${spec.sexual ? "hữu tính" : "vô tính "}  pop ${String(stats.pop).padStart(4)}  ${cases.at(-1).checksum}\n`,
  );
}

await mkdir(new URL("../tests/fixtures/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../tests/fixtures/golden-master.json", import.meta.url),
  JSON.stringify({ note: "Sinh bởi scripts/make-golden.mjs. Chỉ cập nhật khi CỐ Ý đổi mô hình.", cases }, null, 2) + "\n",
);
console.log(`\n${cases.length} trường hợp đã ghi vào tests/fixtures/golden-master.json`);
