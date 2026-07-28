// Đo hiệu năng engine hiện tại. Chạy: node scripts/benchmark.mjs
//
// Bài học từ lần đo trước: KHÔNG so sánh nhiều biến thể trong cùng một tiến
// trình. Biến thể chạy đầu tiên luôn bị phạt vì JIT còn nguội, và thiên lệch đó
// đủ lớn để tạo ra một con số "nhanh gấp đôi" hoàn toàn giả. Muốn so hai bản
// engine thì chạy script này hai lần ở hai tiến trình riêng, mỗi bản vài lượt,
// rồi so phân bố — chênh lệch dưới ~15% trên máy thường là nhiễu.
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");
const context = vm.createContext({ console, globalThis: {}, Math, Map, Set, Number });
vm.runInContext(
  html.match(/\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/)[1],
  context,
);
const engine = context.globalThis.DarwinEngine;

const DAYS = 25;
const CASES = [
  ["baseline", false],
  ["scarcity", false],
  ["abundance", false],
  ["predator", false],
  ["islands", true],
  ["abundance", true],
];

// làm nóng JIT bằng một bản chạy bỏ đi, để trường hợp đầu tiên không bị phạt
new engine.World({ seed: 1, scenario: "baseline" }).runTicks(engine.TICKS_PER_DAY * 8);

console.log(`${DAYS} ngày mỗi trường hợp\n`);
console.log("kịch bản".padEnd(12) + "sinh sản".padStart(10) + "pop".padStart(6) +
  "tổng (ms)".padStart(11) + "ms/ngày".padStart(10) + "µs/nhịp".padStart(10));
console.log("-".repeat(59));

let total = 0;
for (const [scenario, sexual] of CASES) {
  const world = new engine.World({ seed: 909, scenario, sexual });
  const started = process.hrtime.bigint();
  world.runTicks(engine.TICKS_PER_DAY * DAYS);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  total += ms;
  console.log(
    scenario.padEnd(12) +
    (sexual ? "hữu tính" : "vô tính").padStart(10) +
    String(world.creatures.length).padStart(6) +
    ms.toFixed(0).padStart(11) +
    (ms / DAYS).toFixed(1).padStart(10) +
    ((ms / (DAYS * engine.TICKS_PER_DAY)) * 1000).toFixed(0).padStart(10),
  );
}
console.log("-".repeat(59));
console.log("tổng".padEnd(28) + total.toFixed(0).padStart(11));
console.log(
  "\nPhân bổ đã đo bằng --cpu-prof: query ~29%, step ~30%, RNG (random+gauss) ~30%.\n" +
  "Phần RNG không rút ngắn được nếu vẫn muốn cùng hạt giống cho cùng kết quả.",
);
