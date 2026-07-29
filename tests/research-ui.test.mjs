import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/darwin-lab.html", import.meta.url), "utf8");

test("renders the full research-scenario laboratory", () => {
  const scenarioButtons = html.match(/data-scenario="/g) ?? [];
  assert.equal(scenarioButtons.length, 8);

  for (const id of [
    "scenarioGrid",
    "studyMode",
    "scenarioB",
    "sDiversity",
    "sFitness",
    "sEffective",
    "sTemperature",
    "researchChart",
    "eventLog",
    "conclusion",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("exposes all seven genes and reproducibility controls", () => {
  for (const gene of [
    "speed",
    "size",
    "perception",
    "metabolism",
    "immunity",
    "camouflage",
    "fecundity",
  ]) {
    assert.match(html, new RegExp(`data-gene=["']${gene}["']`));
  }

  for (const id of [
    "btnSave",
    "btnLoad",
    "btnExportJson",
    "btnExportCsv",
    "timeline",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(html, /localStorage/);
  assert.match(html, /downloadExperiment/);
});

test("shows per-gene spread, which the aggregate diversity index hides", () => {
  // The diversity stat averages all seven genes, so one strongly polymorphic
  // gene is diluted sevenfold and vanishes. Each track carries its own
  // mean +/- 1 SD band.
  for (const id of [
    "dSpeed",
    "dSize",
    "dPerc",
    "dMetabolism",
    "dImmunity",
    "dCamouflage",
    "dFecundity",
  ]) {
    assert.match(html, new RegExp(`class="gene-spread" id="${id}"`));
  }
  assert.match(html, /\.gene-spread\{position:absolute/);
  assert.match(html, /updateGeneMeters\(stats,metrics\.selectionDifferential,metrics\.geneVariance\)/);
});
