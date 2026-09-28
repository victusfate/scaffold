#!/usr/bin/env node

import type { CpuInfo } from 'node:os';
import { collectHostStatus } from './queue-host-status.ts';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const GIB = 1024 ** 3;
const cpu = (idle: number, user: number): CpuInfo => ({
  model: 'test-core', speed: 3200,
  times: { idle, user, sys: 0, nice: 0, irq: 0 },
});

{
  const frames = [[cpu(100, 100)], [cpu(125, 175)]];
  const status = await collectHostStatus('/queue', {
    cpuSample: () => frames.shift()!,
    sleep: async () => {},
    totalMemory: () => 64 * GIB,
    availableMemory: () => 23 * GIB,
    filesystem: () => Promise.resolve({ totalBytes: 512 * GIB, availableBytes: 211 * GIB }),
    gpu: () => Promise.resolve({ available: false, reason: 'not installed' }),
    environment: {},
    sampledAt: () => '2026-09-28T18:00:00.000Z',
  });

  assert('portable CPU sampling uses deltas', status.cpu.available
    && status.cpu.utilizationPercent === 75, JSON.stringify(status.cpu));
  assert('memory reports non-default available and total bytes', status.memory.availableBytes === 23 * GIB
    && status.memory.totalBytes === 64 * GIB);
  assert('filesystem reports the probed path and bytes', status.disk.available
    && status.disk.path === '/queue' && status.disk.availableBytes === 211 * GIB);
  assert('snapshot timestamp comes from the probe boundary', status.sampledAt === '2026-09-28T18:00:00.000Z');
}

console.error(`\nqueue-host-status.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
