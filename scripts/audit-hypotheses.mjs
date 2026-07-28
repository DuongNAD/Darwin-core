// Đối chiếu giả thuyết của từng kịch bản với dữ liệu.
//
// Mỗi kịch bản tự khai một giả thuyết, nhưng khai không có nghĩa là đúng. Script
// này chạy nhiều bản lặp của kịch bản và của nhóm đối chứng trên cùng bộ hạt
// giống, rồi kiểm định Welch từng tính trạng. Khoảng tin cậy chứa 0 nghĩa là dữ
// liệu chưa đủ để nói kịch bản có tác động lên tính trạng đó.
//
// Chạy: node scripts/audit-hypotheses.mjs [số-bản-lặp] [số-ngày]
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const REPLICATES = Number(process.argv[2]) || 6;
const DAYS = Number(process.argv[3]) || 40;

const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");
const context = vm.createContext({ console, globalThis: {}, Math, Map, Set, Number });
vm.runInContext(
  html.match(/\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/)[1],
  context,
);
const engine = context.globalThis.DarwinEngine;

const TRAITS = [
  ["population", "quần thể", 0],
  ["geneticDiversity", "đa dạng", 3],
  ["speed", "tốc độ", 2],
  ["size", "kích thước", 2],
  ["perception", "cảm nhận", 0],
  ["metabolism", "trao đổi chất", 2],
  ["immunity", "miễn dịch", 2],
  ["camouflage", "ngụy trang", 2],
  ["fecundity", "sinh sản", 2],
];

function replicates(scenario) {
  const rows = [];
  for (let i = 0; i < REPLICATES; i++) {
    const world = new engine.World({ seed: 20260728 + i * 7919, scenario });
    world.runTicks(engine.TICKS_PER_DAY * DAYS);
    rows.push(engine.replicateStudy(world));
  }
  return rows;
}

console.log(`Đối chứng: ${REPLICATES} bản lặp × ${DAYS} ngày, cùng bộ hạt giống cho mọi kịch bản.`);
console.log("Δ là kịch bản trừ đối chứng, kèm khoảng tin cậy 95% (Welch).\n");

const control = replicates("baseline");

for (const [id, scenario] of Object.entries(engine.SCENARIOS)) {
  if (id === "baseline") continue;
  const treatment = replicates(id);

  console.log("=".repeat(92));
  console.log(`${id.toUpperCase()} — ${scenario.name}`);
  console.log(`giả thuyết: ${scenario.hypothesis}`);
  console.log("-".repeat(92));

  const moved = [];
  for (const [key, label, digits] of TRAITS) {
    const delta = engine.welchDifference(
      control.map((r) => r[key]),
      treatment.map((r) => r[key]),
    );
    if (!Number.isFinite(delta.difference)) continue;
    const sign = delta.difference >= 0 ? "+" : "";
    const verdict = delta.significant ? "KHÁC BIỆT" : "chưa kết luận";
    if (delta.significant) moved.push(`${label} ${sign}${delta.difference.toFixed(digits)}`);
    console.log(
      "  " + label.padEnd(15) +
      `${sign}${delta.difference.toFixed(digits)}`.padStart(9) +
      `  [${delta.low.toFixed(digits)}, ${delta.high.toFixed(digits)}]`.padEnd(24) +
      verdict,
    );
  }
  console.log("  " + "-".repeat(88));
  console.log("  tác động đo được: " + (moved.length ? moved.join(" · ") : "KHÔNG CÓ TÍNH TRẠNG NÀO"));
  console.log();
}
