#!/usr/bin/env node
// Measured local gate attempts and explicit review evidence for delivery-metrics.
// Usage: imported by delivery-metrics.ts; reads .agent/rigor.jsonl without network.
import { existsSync, readFileSync } from 'node:fs';

export interface GateAttempt {
  kind: 'attempt'; id: string; unit: string; stage: string; attempt: number;
  startedAt: string; durationMs: number; outcome: 'passed' | 'failed';
}
export interface GateReview { kind: 'review'; id: string; falsePositive: boolean; evidence: string }
export type RigorRecord = GateAttempt | GateReview;
export interface StageCost {
  stage: string; minutes: number; attempts: number; firstTries: number; firstTryPassed: number;
  failures: number; reviewedFailures: number; falsePositives: number;
}
export interface RigorMetrics { stages: StageCost[]; daily: { date: string; gates: StageCost[] }[] }
const MINUTE_MS = 60_000;
const CONTROL_LIMIT = 32;
const DELETE_CODE = 127;
const PERCENT = 100;
const MAX_TEXT_LENGTH = 2000;
const TOKEN = /^[\w./:@-]+$/;

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT_LENGTH || [...value].some(char => char.charCodeAt(0) < CONTROL_LIMIT || char.charCodeAt(0) === DELETE_CODE))
    throw new Error(`invalid ${label}`);
  return value;
}
function token(value: unknown, label: string): string {
  const result = text(value, label);
  if (!TOKEN.test(result)) throw new Error(`invalid ${label}`);
  return result;
}
function fields(row: Record<string, unknown>, names: string[]): void {
  if (Object.keys(row).some(key => !names.includes(key))) throw new Error('unknown rigor field');
}
function timestamp(value: unknown): void {
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error('invalid timestamp');
}
function validateAttempt(row: Record<string, unknown>): GateAttempt {
  fields(row, ['kind', 'id', 'unit', 'stage', 'attempt', 'startedAt', 'durationMs', 'outcome']);
  for (const name of ['id', 'unit', 'stage']) token(row[name], name);
  if (!Number.isSafeInteger(row.attempt) || Number(row.attempt) < 1) throw new Error('invalid attempt number');
  if (typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs) || row.durationMs < 0)
    throw new Error('invalid duration');
  timestamp(row.startedAt);
  if (row.outcome !== 'passed' && row.outcome !== 'failed') throw new Error('invalid outcome');
  return row as unknown as GateAttempt;
}
export function validateRecord(value: unknown): RigorRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid rigor record');
  const row = value as Record<string, unknown>;
  if (row.kind === 'attempt') return validateAttempt(row);
  if (row.kind !== 'review') throw new Error('invalid rigor kind');
  fields(row, ['kind', 'id', 'falsePositive', 'evidence']);
  token(row.id, 'id'); text(row.evidence, 'evidence');
  if (typeof row.falsePositive !== 'boolean') throw new Error('invalid falsePositive judgment');
  return row as unknown as GateReview;
}

/** Missing telemetry means unknown, never zero-cost or a clean first pass. */
export function readRigor(path: string): RigorRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(line => line.trim()).map((line, index) => {
    try { return validateRecord(JSON.parse(line)); }
    catch (error) { throw new Error(`rigor log line ${index + 1}: ${String(error)}`, { cause: error }); }
  });
}
function validateRelations(records: RigorRecord[]): Map<string, GateReview> {
  const attempts = new Map<string, GateAttempt>();
  const ordinals = new Set<string>();
  for (const row of records) {
    if (row.kind !== 'attempt') continue;
    const ordinal = JSON.stringify([row.unit, row.stage, row.attempt]);
    if (attempts.has(row.id) || ordinals.has(ordinal)) throw new Error('duplicate gate attempt');
    attempts.set(row.id, row); ordinals.add(ordinal);
  }
  const reviews = new Map<string, GateReview>();
  for (const row of records) {
    if (row.kind !== 'review') continue;
    const attempt = attempts.get(row.id);
    if (!attempt) throw new Error(`review refers to unknown attempt: ${row.id}`);
    if (attempt.outcome !== 'failed') throw new Error('only failed gates can be adjudicated');
    if (reviews.has(row.id)) throw new Error('duplicate review');
    reviews.set(row.id, row);
  }
  return reviews;
}
function costs(attempts: GateAttempt[], reviews: Map<string, GateReview>): StageCost[] {
  const stages = new Map<string, StageCost>();
  for (const row of attempts) {
    const stage = stages.get(row.stage) ?? { stage: row.stage, minutes: 0, attempts: 0, firstTries: 0,
      firstTryPassed: 0, failures: 0, reviewedFailures: 0, falsePositives: 0 };
    stage.minutes += row.durationMs / MINUTE_MS;
    stage.attempts++;
    if (row.attempt === 1) { stage.firstTries++; if (row.outcome === 'passed') stage.firstTryPassed++; }
    if (row.outcome === 'failed') stage.failures++;
    if (reviews.has(row.id)) stage.reviewedFailures++;
    if (reviews.get(row.id)?.falsePositive) stage.falsePositives++;
    stages.set(row.stage, stage);
  }
  return [...stages.values()].sort((a, b) => b.minutes - a.minutes || a.stage.localeCompare(b.stage));
}
export function rigorMetrics(input: unknown[]): RigorMetrics {
  const records = input.map(validateRecord);
  const reviews = validateRelations(records);
  const attempts = records.filter((r): r is GateAttempt => r.kind === 'attempt');
  const dates = [...new Set(attempts.map(row => row.startedAt.slice(0, 'YYYY-MM-DD'.length)))].sort().reverse();
  return { stages: costs(attempts, reviews), daily: dates.map(date => ({ date,
    gates: costs(attempts.filter(row => row.startedAt.startsWith(date)), reviews) })) };
}
const rate = (numerator: number, denominator: number) => denominator ? `${(numerator / denominator * PERCENT).toFixed(1)}%` : 'n/a';
export function formatRigor(metrics: RigorMetrics): string {
  if (!metrics.stages.length) return 'Cost of rigor: no gate attempts recorded (unknown costs and pass rates)\nOperational cost signals do not establish customer success.\nOutcome/risk/learning evidence: not measured here; see feature design/QA evidence.';
  const rows = metrics.stages.map(s => `  ${s.stage}: ${s.minutes.toFixed(1)}m (${s.attempts} attempts); `
    + `first-try ${rate(s.firstTryPassed, s.firstTries)} (${s.firstTryPassed}/${s.firstTries}); `
    + `false-positive ${rate(s.falsePositives, s.reviewedFailures)} of reviewed failures (${s.reviewedFailures}/${s.failures} failures reviewed)`);
  const daily = metrics.daily.flatMap(d => [`  ${d.date} (most expensive first):`,
    ...d.gates.map((s, i) => `    ${i + 1}. ${s.stage}: ${s.minutes.toFixed(1)}m`)]);
  return ['Cost of rigor (measured gate execution; operational signals, not customer success):',
    'Outcome/risk/learning evidence: not measured here; see feature design/QA evidence.', ...rows, 'Daily gate cost (UTC):', ...daily].join('\n');
}
