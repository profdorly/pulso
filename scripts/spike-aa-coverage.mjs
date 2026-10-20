#!/usr/bin/env node
/**
 * Data-sufficiency spike for the Artificial Analysis free tier.
 *
 * Answers one question before any model-catalogue UI is built: per modality, which fields
 * does the free tier actually return, and are they enough to guide a decision? Docs say
 * what is *possible*; only a live call says what arrives.
 *
 * Read-only, one GET per endpoint (free tier allows 100 per 24h). The API key is read from
 * backend/.env and never printed.
 *
 * Usage: node scripts/spike-aa-coverage.mjs [--out research/aa-coverage.md]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argValue(flag, fallback) {
  const prefix = `${flag}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function readEnvValue(key) {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(repoRoot, "backend", ".env");
  if (!existsSync(envPath)) return undefined;
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [name, ...rest] = line.split("=");
    if (name.trim() === key) {
      const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
      return value || undefined;
    }
  }
  return undefined;
}

const apiKey = readEnvValue("ARTIFICIAL_ANALYSIS_API_KEY");
if (!apiKey) {
  throw new Error("ARTIFICIAL_ANALYSIS_API_KEY not found in env or backend/.env");
}

const BASE = "https://artificialanalysis.ai/api/v2";

const ENDPOINTS = [
  { modality: "language (texto/multimodal)", path: "/language/models/free" },
  { modality: "text-to-image", path: "/media/text-to-image/models/free" },
  { modality: "image-editing", path: "/media/image-editing/models/free" },
  { modality: "text-to-video", path: "/media/text-to-video/models/free" },
  { modality: "image-to-video", path: "/media/image-to-video/models/free" },
  { modality: "text-to-video-audio", path: "/media/text-to-video-audio/models/free" },
  { modality: "image-to-video-audio", path: "/media/image-to-video-audio/models/free" },
];

/** Records which leaf paths are present and non-null across a sample of objects. */
function fieldCoverage(models) {
  const counts = new Map();

  function walk(value, prefix) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (value.length > 0) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        walk(nested, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  for (const model of models) walk(model, "");
  return [...counts.entries()]
    .map(([field, count]) => ({ field, count, pct: Math.round((count / models.length) * 100) }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
}

const results = [];

for (const endpoint of ENDPOINTS) {
  const url = `${BASE}${endpoint.path}`;
  try {
    const response = await fetch(url, { headers: { "x-api-key": apiKey } });
    const text = await response.text();

    if (!response.ok) {
      results.push({
        ...endpoint,
        status: response.status,
        error: text.slice(0, 200),
        models: 0,
        fields: [],
      });
      continue;
    }

    const body = JSON.parse(text);
    const models = Array.isArray(body.data) ? body.data : [];
    results.push({
      ...endpoint,
      status: response.status,
      tier: body.tier,
      indexVersion: body.intelligence_index_version,
      models: models.length,
      fields: fieldCoverage(models),
      sampleNames: models.slice(0, 5).map((row) => row.name ?? row.slug ?? "?"),
    });
  } catch (error) {
    results.push({
      ...endpoint,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      models: 0,
      fields: [],
    });
  }
}

const lines = [
  "# Artificial Analysis free tier — cobertura real por modalidade",
  "",
  `Medido em ${new Date().toISOString()} com uma requisição GET por endpoint no tier gratuito.`,
  "Este arquivo é gerado por `node scripts/spike-aa-coverage.mjs`. A pergunta que ele responde:",
  "os dados que chegam sustentam um guia de decisão por modalidade, ou só um ranking?",
  "",
];

for (const result of results) {
  lines.push(`## ${result.modality}`);
  lines.push("");
  lines.push(`- endpoint: \`${result.path}\``);
  lines.push(`- status: ${result.status}${result.tier ? ` (tier \`${result.tier}\`)` : ""}`);
  if (result.indexVersion) lines.push(`- intelligence_index_version: ${result.indexVersion}`);
  lines.push(`- modelos retornados: ${result.models}`);
  if (result.error) lines.push(`- erro: \`${result.error.replace(/`/g, "'")}\``);
  if (result.sampleNames?.length) {
    lines.push(`- amostra: ${result.sampleNames.join(", ")}`);
  }
  if (result.fields.length > 0) {
    lines.push("");
    lines.push("| campo | preenchido em |");
    lines.push("| --- | --- |");
    for (const field of result.fields) {
      lines.push(`| \`${field.field}\` | ${field.pct}% (${field.count}/${result.models}) |`);
    }
  }
  lines.push("");
}

const outPath = path.resolve(repoRoot, argValue("--out", "research/aa-coverage.md"));
writeFileSync(outPath, `${lines.join("\n")}\n`);

process.stdout.write(`\nRelatório: ${path.relative(repoRoot, outPath)}\n\n`);
for (const result of results) {
  const summary = result.error
    ? `ERRO ${result.status}`
    : `${result.models} modelos, ${result.fields.length} campos`;
  process.stdout.write(`  ${result.modality.padEnd(28)} ${summary}\n`);
}
