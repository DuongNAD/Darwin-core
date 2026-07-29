#!/usr/bin/env node
// Darwin Lab MCP server — stdio.
//
// Exposes the simulation's control port over MCP so an agent can run and steer
// experiments. The engine is the SAME source the browser runs: it is extracted
// from public/darwin-lab.html at startup, so this server can never drift from
// the lab people actually look at.
//
// Every mutating tool is recorded in the world's intervention log, exactly as
// the in-page desk is, so a session an agent meddled with never looks clean.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const ARTIFACT = fileURLToPath(new URL("../public/darwin-lab.html", import.meta.url));
const CORE = /\/\/ ===== SIM CORE START =====([\s\S]*?)\/\/ ===== SIM CORE END =====/;

async function loadEngine() {
  const html = await readFile(ARTIFACT, "utf8");
  const match = html.match(CORE);
  if (!match) {
    throw new Error(
      `Simulation core markers not found in ${ARTIFACT}. ` +
        "The server reads the engine out of the shipped artifact; if that file moved, " +
        "point this server at the new location.",
    );
  }
  const context = vm.createContext({ console, globalThis: {}, Math, Map, Set, Number });
  vm.runInContext(match[1], context);
  const engine = context.globalThis.DarwinEngine;
  if (!engine) throw new Error("The simulation core did not expose DarwinEngine.");
  return engine;
}

const engine = await loadEngine();
const SCENARIOS = Object.keys(engine.SCENARIOS);
const GENES = engine.GENE_KEYS;

// One live world per server process. Replaced by darwin_new_experiment.
let world = new engine.World({ seed: 20260728, scenario: "baseline" });
const control = new engine.Controller(() => world);

// ---------------------------------------------------------------- formatting
const FormatArg = {
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("markdown for reading, json for further processing"),
};

function reply(format, data, toMarkdown) {
  const text = format === "json" ? JSON.stringify(data, null, 2) : toMarkdown(data);
  return { content: [{ type: "text", text }], structuredContent: data };
}

function fail(error, hint) {
  return {
    isError: true,
    content: [{ type: "text", text: `${error.message}${hint ? ` ${hint}` : ""}` }],
  };
}

const num = (value, digits = 3) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";

function stateMarkdown(state) {
  const t = state.trophic;
  return [
    `# Ngày ${state.day} — ${state.scenario} (hạt giống ${state.seed})`,
    "",
    `- Sinh sản: ${state.reproduction}`,
    `- Thực vật: ${t.plantsGrown} trưởng thành / ${t.plants} tổng`,
    `- Loài ăn cỏ: ${t.herbivores}`,
    `- Loài ăn thịt: ${t.carnivores}`,
    `- Đa dạng di truyền: ${num(state.geneticDiversity)}`,
    `- Dòng dõi hiệu dụng: ${num(state.effectiveLineages, 1)}`,
    `- Số con trọn đời: ${num(state.meanOffspring, 2)}`,
    `- Phân hoá Q_ST: ${state.differentiation === null ? "không áp dụng" : num(state.differentiation)}`,
    `- Sinh / chết: ${state.births} / ${state.deaths}`,
    `- Can thiệp thủ công đã ghi: ${state.interventions}`,
  ].join("\n");
}

function geneMarkdown(pool) {
  const rows = Object.entries(pool).map(
    ([gene, s]) =>
      `| ${gene} | ${num(s.mean)} | ${num(s.sd)} | ${num(s.min)} | ${num(s.max)} | ${s.range.join(" – ")} |`,
  );
  return [
    "| gene | trung bình | độ lệch | nhỏ nhất | lớn nhất | dải cho phép |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

// -------------------------------------------------------------------- server
const server = new McpServer({ name: "darwin-lab-mcp-server", version: "1.0.0" });

const withState = (extra = {}) => ({ ...control.state(), ...extra });

server.registerTool(
  "darwin_get_state",
  {
    title: "Đọc trạng thái mô phỏng",
    description:
      "Trạng thái hiện tại của thế giới đang chạy: ngày, kịch bản, ba bậc dinh dưỡng " +
      "(thực vật / ăn cỏ / ăn thịt), các chỉ số di truyền, và số can thiệp thủ công đã ghi. " +
      "Mọi chỉ số di truyền tính trên loài ăn cỏ.",
    inputSchema: { ...FormatArg },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ response_format }) => reply(response_format, control.state(), stateMarkdown),
);

server.registerTool(
  "darwin_get_gene_pool",
  {
    title: "Đọc vốn gene",
    description:
      "Trung bình, độ lệch chuẩn, giá trị nhỏ nhất và lớn nhất của cả bảy gene, kèm dải cho phép. " +
      "Mặc định đọc loài ăn cỏ; truyền species='carnivore' để xem loài săn mồi.",
    inputSchema: {
      species: z.enum(["herbivore", "carnivore"]).default("herbivore"),
      ...FormatArg,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ species, response_format }) =>
    reply(response_format, control.genePool(species), geneMarkdown),
);

server.registerTool(
  "darwin_list_creatures",
  {
    title: "Liệt kê cá thể",
    description:
      "Danh sách cá thể kèm gene, tuổi, năng lượng, số con và dòng dõi. Có phân trang. " +
      "Dùng để soi từng cá thể; muốn số tổng hợp thì dùng darwin_get_gene_pool.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(20),
      offset: z.number().int().min(0).default(0),
      ...FormatArg,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit, offset, response_format }) => {
    const total = world.creatures.length;
    const items = control.listCreatures(limit, offset);
    const page = {
      total,
      count: items.length,
      offset,
      has_more: offset + items.length < total,
      next_offset: offset + items.length < total ? offset + items.length : null,
      items,
    };
    return reply(response_format, page, (data) =>
      [
        `${data.count} / ${data.total} cá thể (từ ${data.offset})`,
        "",
        ...data.items.map(
          (c) =>
            `- #${c.id} ${c.species} · thế hệ ${c.generation} · năng lượng ${num(c.energy, 0)} · ` +
            `con ${c.offspring} · tốc độ ${num(c.genes.speed, 2)} kích thước ${num(c.genes.size, 2)}`,
        ),
        data.has_more ? `\nCòn nữa — gọi lại với offset=${data.next_offset}.` : "",
      ].join("\n"),
    );
  },
);

server.registerTool(
  "darwin_get_history",
  {
    title: "Đọc lịch sử theo ngày",
    description:
      "Số liệu từng ngày: quần thể mỗi bậc, đa dạng, trung bình từng gene. " +
      "Trả về những ngày GẦN NHẤT.",
    inputSchema: {
      days: z.number().int().min(1).max(600).default(30),
      ...FormatArg,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ days, response_format }) => {
    const rows = control.history(days);
    // structuredContent phải là object, không được là mảng trần.
    return reply(response_format, { count: rows.length, days: rows }, ({ days: list }) =>
      [
        "| ngày | ăn cỏ | ăn thịt | cây chín | đa dạng | tốc độ | kích thước |",
        "|---|---|---|---|---|---|---|",
        ...list.map(
          (r) =>
            `| ${r.day} | ${r.pop} | ${r.carnivores ?? 0} | ${r.plantsGrown ?? 0} | ` +
            `${num(r.diversity)} | ${num(r.speed, 2)} | ${num(r.size, 2)} |`,
        ),
      ].join("\n"),
    );
  },
);

server.registerTool(
  "darwin_get_interventions",
  {
    title: "Đọc nhật ký can thiệp",
    description:
      "Mọi thao tác đã tác động vào quần thể này. Một bản chạy có can thiệp không được " +
      "coi là bản chạy sạch — kiểm tra nhật ký này trước khi rút kết luận.",
    inputSchema: { ...FormatArg },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ response_format }) => {
    const entries = control.log();
    return reply(response_format, { count: entries.length, entries }, ({ entries: list }) =>
      list.length
        ? list.map((e) => `- NGÀY ${e.day}: ${e.action} — ${e.detail}`).join("\n")
        : "Chưa có can thiệp nào — quần thể này chạy sạch.",
    );
  },
);

server.registerTool(
  "darwin_advance_days",
  {
    title: "Chạy tiếp",
    description:
      "Chạy mô phỏng thêm một số ngày. Đây là cách duy nhất để thời gian trôi; " +
      "các tool khác chỉ đọc hoặc can thiệp tức thời.",
    inputSchema: {
      days: z.number().int().min(1).max(60).default(1),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ days, response_format }) => {
    control.advance(days);
    return reply(response_format, control.state(), stateMarkdown);
  },
);

server.registerTool(
  "darwin_inject_creatures",
  {
    title: "Thả thêm cá thể",
    description:
      "Thêm cá thể mang bộ gene chỉ định. Gene nào bỏ trống thì lấy trung bình hiện tại " +
      "CỦA CHÍNH LOÀI ĐÓ. Dùng để đưa vào một biến dị hoặc gây dựng lại quần thể đã sụp.",
    inputSchema: {
      count: z.number().int().min(1).max(200).default(10),
      species: z.enum(["herbivore", "carnivore"]).default("herbivore"),
      genes: z
        .object(Object.fromEntries(GENES.map((g) => [g, z.number().optional()])))
        .partial()
        .optional()
        .describe("gene muốn đặt, ví dụ {\"speed\": 3.2}; giá trị bị kẹp vào dải cho phép"),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ count, species, genes, response_format }) => {
    try {
      const result = control.inject({ count, species, genes: genes || {} });
      return reply(response_format, withState({ injected: result.injected, species: result.species }), (d) =>
        `Đã thả ${d.injected} cá thể ${d.species}.\n\n${stateMarkdown(d)}`,
      );
    } catch (error) {
      return fail(error, "Kiểm tra tên gene — chỉ nhận: " + GENES.join(", ") + ".");
    }
  },
);

server.registerTool(
  "darwin_set_gene",
  {
    title: "Đặt gene",
    description:
      "Đặt thẳng một gene cho một phần quần thể ăn cỏ. Giá trị bị kẹp vào dải cho phép. " +
      "Dùng fraction < 1 để tạo áp lực chọn giống thay vì thay đổi toàn bộ.",
    inputSchema: {
      gene: z.enum(GENES),
      value: z.number(),
      fraction: z.number().min(0).max(1).default(1).describe("tỷ lệ quần thể bị tác động"),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ gene, value, fraction, response_format }) => {
    try {
      const result = control.setGene(gene, value, { fraction });
      return reply(response_format, withState(result), (d) =>
        `Đặt ${d.gene} = ${num(d.value, 3)} cho ${d.touched} cá thể.\n\n${stateMarkdown(d)}`,
      );
    } catch (error) {
      return fail(error, "Gene hợp lệ: " + GENES.join(", ") + ".");
    }
  },
);

server.registerTool(
  "darwin_nudge_gene",
  {
    title: "Dịch chuyển gene",
    description:
      "Cộng thêm một lượng vào một gene của một phần quần thể, giữ nguyên biến dị sẵn có. " +
      "Khác với darwin_set_gene ở chỗ không xoá phương sai.",
    inputSchema: {
      gene: z.enum(GENES),
      delta: z.number(),
      fraction: z.number().min(0).max(1).default(1),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ gene, delta, fraction, response_format }) => {
    try {
      const result = control.nudgeGene(gene, delta, { fraction });
      return reply(response_format, withState(result), (d) =>
        `Dịch ${d.gene} ${d.delta >= 0 ? "+" : ""}${num(d.delta, 3)} cho ${d.touched} cá thể.\n\n${stateMarkdown(d)}`,
      );
    } catch (error) {
      return fail(error, "Gene hợp lệ: " + GENES.join(", ") + ".");
    }
  },
);

server.registerTool(
  "darwin_cull",
  {
    title: "Loại bỏ ngẫu nhiên",
    description:
      "Giết ngẫu nhiên một phần quần thể — thắt cổ chai do người tạo ra. " +
      "Không hoàn tác được; fraction = 1 xoá sạch quần thể.",
    inputSchema: {
      fraction: z.number().min(0).max(1).default(0.5),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ fraction, response_format }) => {
    const result = control.cull({ fraction });
    return reply(response_format, withState(result), (d) =>
      `Đã loại bỏ ${d.removed} cá thể.\n\n${stateMarkdown(d)}`,
    );
  },
);

server.registerTool(
  "darwin_set_parameter",
  {
    title: "Đổi tham số môi trường",
    description:
      "Đổi một tham số của thế giới đang chạy: foodPerDay, mutation, costMul, predation, sexual, " +
      "và các cờ riêng của kịch bản. Có hiệu lực ngay, không cần đặt lại.",
    inputSchema: {
      parameter: z.string().describe("tên tham số, ví dụ foodPerDay"),
      value: z.union([z.number(), z.boolean()]),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ parameter, value, response_format }) => {
    try {
      const result = control.setParam(parameter, value);
      return reply(response_format, withState(result), (d) =>
        `${d.param}: ${d.from} → ${d.to}\n\n${stateMarkdown(d)}`,
      );
    } catch (error) {
      return fail(error, "Tham số hiện có: " + Object.keys(world.params).join(", ") + ".");
    }
  },
);

server.registerTool(
  "darwin_add_plants",
  {
    title: "Gieo thêm hạt",
    description:
      "Gieo thêm hạt vào môi trường. Hạt cần khoảng 200 nhịp (một ngày) để trưởng thành; " +
      "mầm non chưa ăn được nên hiệu quả không tức thời.",
    inputSchema: {
      count: z.number().int().min(1).max(600).default(100),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ count, response_format }) => {
    const result = control.addFood(count);
    return reply(response_format, withState(result), (d) =>
      `Đã gieo ${d.added} hạt.\n\n${stateMarkdown(d)}`,
    );
  },
);

server.registerTool(
  "darwin_new_experiment",
  {
    title: "Thí nghiệm mới",
    description:
      "Vứt thế giới hiện tại và bắt đầu lại với kịch bản, hạt giống và chế độ sinh sản chỉ định. " +
      "Cùng một hạt giống luôn cho cùng một kết quả, nên đây là cách chạy đối chứng.",
    inputSchema: {
      scenario: z.enum(SCENARIOS).default("baseline"),
      seed: z.number().int().default(20260728),
      sexual: z.boolean().default(false).describe("true = sinh sản hữu tính có tái tổ hợp"),
      ...FormatArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ scenario, seed, sexual, response_format }) => {
    world = new engine.World({ scenario, seed, sexual });
    return reply(response_format, control.state(), stateMarkdown);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout carries the protocol; anything human-facing must go to stderr.
process.stderr.write(
  `darwin-lab-mcp-server sẵn sàng — ${SCENARIOS.length} kịch bản, engine đọc từ ${ARTIFACT}\n`,
);
