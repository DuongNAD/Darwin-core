// Drives the MCP server the way a client does: spawn it, speak JSON-RPC over
// stdio, and check what comes back. Nothing here reaches into the server's
// internals, so a break in the wiring shows up rather than being papered over.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SERVER = fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));

class Client {
  constructor() {
    this.child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const resolve = this.pending.get(message.id);
        if (resolve) { this.pending.delete(message.id); resolve(message); }
      }
    });
  }
  send(method, params) {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params: params ?? {} };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out. stderr: ${this.stderr}`)),
        20000,
      );
      this.pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }
  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} })}\n`);
  }
  async start() {
    const result = await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "darwin-lab-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    return result;
  }
  async call(name, args) {
    const response = await this.send("tools/call", { name, arguments: args ?? {} });
    assert.ok(!response.error, `${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  }
  async callJson(name, args) {
    const result = await this.call(name, { ...(args ?? {}), response_format: "json" });
    return JSON.parse(result.content[0].text);
  }
  stop() { this.child.kill(); }
}

async function withClient(run) {
  const client = new Client();
  try {
    await client.start();
    await run(client);
  } finally {
    client.stop();
  }
}

test("starts, handshakes, and keeps the protocol off stdout", async () => {
  await withClient(async (client) => {
    const listed = await client.send("tools/list");
    const names = listed.result.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      "darwin_add_plants",
      "darwin_advance_days",
      "darwin_cull",
      "darwin_get_gene_pool",
      "darwin_get_history",
      "darwin_get_interventions",
      "darwin_get_state",
      "darwin_inject_creatures",
      "darwin_list_creatures",
      "darwin_new_experiment",
      "darwin_nudge_gene",
      "darwin_set_gene",
      "darwin_set_parameter",
    ]);

    // Every tool has to declare what it does and whether it writes.
    for (const tool of listed.result.tools) {
      assert.ok(tool.description?.length > 40, `${tool.name} needs a real description`);
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", tool.name);
    }
    const readOnly = listed.result.tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
    assert.deepEqual(readOnly.sort(), [
      "darwin_get_gene_pool",
      "darwin_get_history",
      "darwin_get_interventions",
      "darwin_get_state",
      "darwin_list_creatures",
    ]);
  });
});

test("reads a running world and advances it", async () => {
  await withClient(async (client) => {
    const start = await client.callJson("darwin_get_state");
    assert.equal(start.scenario, "baseline");
    assert.equal(start.interventions, 0);
    assert.equal(typeof start.trophic.herbivores, "number");

    const later = await client.callJson("darwin_advance_days", { days: 3 });
    assert.equal(later.day, start.day + 3, "time only moves through advance");

    const pool = await client.callJson("darwin_get_gene_pool");
    for (const gene of ["speed", "size", "perception", "metabolism", "immunity", "camouflage", "fecundity"]) {
      assert.ok(pool[gene].mean >= pool[gene].range[0], gene);
      assert.ok(pool[gene].mean <= pool[gene].range[1], gene);
    }

    const history = await client.callJson("darwin_get_history", { days: 2 });
    assert.ok(history.days.length <= 2 && history.days.length > 0);
    assert.equal(history.count, history.days.length);

    // Markdown is the default and has to be readable, not a JSON dump.
    const readable = await client.call("darwin_get_state");
    assert.match(readable.content[0].text, /# Ngày \d+/);
    assert.doesNotMatch(readable.content[0].text, /^\{/);
  });
});

test("paginates creature listings", async () => {
  await withClient(async (client) => {
    await client.call("darwin_advance_days", { days: 2 });

    const first = await client.callJson("darwin_list_creatures", { limit: 5, offset: 0 });
    assert.equal(first.count, 5);
    assert.equal(first.offset, 0);
    assert.ok(first.total > 5);
    assert.equal(first.has_more, true);
    assert.equal(first.next_offset, 5);

    const second = await client.callJson("darwin_list_creatures", { limit: 5, offset: first.next_offset });
    assert.equal(second.offset, 5);
    const overlap = first.items.filter((a) => second.items.some((b) => b.id === a.id));
    assert.equal(overlap.length, 0, "pages must not repeat creatures");
  });
});

test("writes are applied and recorded; reads are not", async () => {
  await withClient(async (client) => {
    await client.call("darwin_advance_days", { days: 2 });
    assert.equal((await client.callJson("darwin_get_interventions")).count, 0);

    const set = await client.callJson("darwin_set_gene", { gene: "speed", value: 3.5 });
    assert.ok(set.touched > 0);
    const pool = await client.callJson("darwin_get_gene_pool");
    assert.ok(Math.abs(pool.speed.mean - 3.5) < 1e-9, "the whole population moved");
    assert.ok(pool.speed.sd < 1e-9, "setting a gene removes its variance");

    await client.call("darwin_nudge_gene", { gene: "size", delta: 0.2, fraction: 0.5 });
    await client.call("darwin_inject_creatures", { count: 4, species: "carnivore" });
    await client.call("darwin_add_plants", { count: 30 });

    const log = await client.callJson("darwin_get_interventions");
    assert.deepEqual(log.entries.map((entry) => entry.action), [
      "đặt gene", "dịch gene", "tiêm cá thể", "thêm thức ăn",
    ]);

    const state = await client.callJson("darwin_get_state");
    assert.equal(state.interventions, 4, "the state advertises that this run was touched");
    assert.equal(state.trophic.carnivores, 4);
  });
});

test("bad input is refused with a usable message", async () => {
  await withClient(async (client) => {
    const badGene = await client.send("tools/call", {
      name: "darwin_set_gene",
      arguments: { gene: "wingspan", value: 1 },
    });
    const text = JSON.stringify(badGene.result ?? badGene.error);
    assert.match(text, /wingspan|speed/, "the error should point at the valid options");

    const badParam = await client.call("darwin_set_parameter", {
      parameter: "nonesuch",
      value: 1,
    });
    assert.equal(badParam.isError, true);
    assert.match(badParam.content[0].text, /foodPerDay/, "list the parameters that do exist");
  });
});

test("a new experiment resets the world and its record", async () => {
  await withClient(async (client) => {
    await client.call("darwin_cull", { fraction: 0.5 });
    assert.equal((await client.callJson("darwin_get_state")).interventions, 1);

    const fresh = await client.callJson("darwin_new_experiment", {
      scenario: "islands",
      seed: 4242,
      sexual: true,
    });
    assert.equal(fresh.scenario, "islands");
    assert.equal(fresh.seed, 4242);
    assert.equal(fresh.reproduction, "sexual");
    assert.equal(fresh.interventions, 0, "a fresh world carries no history of meddling");

    // Same seed, same run: the reproducibility guarantee holds across the port.
    await client.call("darwin_advance_days", { days: 4 });
    const a = await client.callJson("darwin_get_state");
    await client.call("darwin_new_experiment", { scenario: "islands", seed: 4242, sexual: true });
    await client.call("darwin_advance_days", { days: 4 });
    const b = await client.callJson("darwin_get_state");
    assert.equal(a.population, b.population);
    assert.equal(a.geneticDiversity, b.geneticDiversity);
  });
});
