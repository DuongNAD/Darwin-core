import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Darwin Lab shell and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="vi">/i);
  assert.match(html, /<title>DARWIN LAB — Chọn lọc tự nhiên<\/title>/i);
  assert.match(html, /src="\/darwin-lab\.html"/i);
  assert.match(html, /title="DARWIN LAB — Mô phỏng chọn lọc tự nhiên"/i);
  assert.match(html, /property="og:image"/i);
  assert.match(html, /\/og\.png/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("ships a self-contained, executable simulation artifact", async () => {
  const source = await readFile(
    new URL("../public/darwin-lab.html", import.meta.url),
    "utf8",
  );

  assert.ok(source.length > 30_000);
  assert.match(source, /DARWIN LAB/);
  assert.match(source, /Chọn lọc tự nhiên/);
  assert.match(source, /Thức ăn mỗi ngày/);
  assert.match(source, /Tần suất đột biến/);
  assert.match(source, /Chi phí năng lượng/);
  assert.match(source, /Săn mồi/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /devicePixelRatio/);
  assert.match(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /\bTODO\b|\bPLACEHOLDER\b/i);

  const script = source.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(script, "simulation script is present");
  assert.doesNotThrow(() => new Function(script[1]));
});
