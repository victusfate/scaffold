#!/usr/bin/env node

import type { CpuInfo } from 'node:os';
import { collectHostStatus, createCachedHostProbe } from './queue-host-status.ts';

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
    nvidiaCsv: () => Promise.reject(new Error('not installed')),
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

{
  const frames = [[cpu(100, 100)], [cpu(110, 190)]];
  const status = await collectHostStatus('C:\\queue', {
    cpuSample: () => frames.shift()!,
    sleep: () => Promise.resolve(),
    totalMemory: () => 64 * GIB,
    availableMemory: () => 15 * GIB,
    filesystem: () => Promise.resolve({ totalBytes: 1000 * GIB, availableBytes: 211 * GIB }),
    nvidiaCsv: () => Promise.resolve({
      device: 'NVIDIA Test GPU, 4, 2712, 32768\n',
      processes: '101\n202\n',
    }),
    environment: {
      QUEUE_MEMORY_RESERVE_GIB: '16',
      QUEUE_DISK_FLOOR_GIB: '205',
      QUEUE_VRAM_RESERVE_GIB: '4',
      QUEUE_WORKER_LIMIT: '3',
    },
  });

  assert('NVIDIA CSV becomes typed GPU pressure', status.gpu.available
    && status.gpu.name === 'NVIDIA Test GPU' && status.gpu.utilizationPercent === 4
    && status.gpu.memoryUsedBytes === 2712 * 1024 ** 2 && status.gpu.computeProcesses === 2);
  assert('configured reserves and worker limit remain distinct', status.limits.memoryReserveBytes === 16 * GIB
    && status.limits.diskFloorBytes === 205 * GIB && status.limits.gpuVramReserveBytes === 4 * GIB
    && status.limits.workerLimit === 3);
  assert('resource guard blocks below the memory reserve', status.guard.overall === 'blocked'
    && status.guard.memory === 'blocked');
}

{
  let calls = 0;
  let now = 10_000;
  const snapshot = {
    sampledAt: 'cached',
    cpu: { available: false as const, reason: 'test' },
    memory: { totalBytes: 1, availableBytes: 1 },
    disk: { available: false as const, path: '/', reason: 'test' },
    gpu: { available: false as const, reason: 'test' },
    limits: { memoryReserveBytes: 1, diskFloorBytes: 1, gpuVramReserveBytes: 1, workerLimit: null },
    guard: { overall: 'clear' as const, cpu: 'unavailable' as const, memory: 'clear' as const,
      disk: 'unavailable' as const, gpu: 'unavailable' as const },
  };
  const cached = createCachedHostProbe(() => { calls++; return Promise.resolve(snapshot); }, 2000, () => now);
  const [first, concurrent] = await Promise.all([cached(), cached()]);
  now += 1999;
  const fresh = await cached();
  now += 2;
  await cached();
  assert('host probe coalesces concurrent and fresh-cache reads', calls === 2
    && first === concurrent && concurrent === fresh, String(calls));
}

console.error(`\nqueue-host-status.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
