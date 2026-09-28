#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { CpuInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    freeMemory: () => 23 * GIB,
    linuxMeminfo: () => Promise.resolve('MemAvailable: 53477376 kB\n'),
    platform: 'linux',
    filesystem: () => Promise.resolve({ totalBytes: 512 * GIB, availableBytes: 211 * GIB }),
    nvidiaCsv: () => Promise.reject(new Error('not installed')),
    worktreeUsage: paths => Promise.resolve({ available: true, activeCount: paths.length, totalBytes: 7 * GIB }),
    environment: {},
    sampledAt: () => '2026-09-28T18:00:00.000Z',
  }, ['/queue/wt/one', '/queue/wt/two']);

  assert('portable CPU sampling uses deltas', status.cpu.available
    && status.cpu.utilizationPercent === 75, JSON.stringify(status.cpu));
  assert('Linux memory uses MemAvailable instead of only free pages', status.memory.availableBytes === 51 * GIB
    && status.memory.totalBytes === 64 * GIB);
  assert('filesystem reports the probed path and bytes', status.disk.available
    && status.disk.path === '/queue' && status.disk.availableBytes === 211 * GIB);
  assert('snapshot timestamp comes from the probe boundary', status.sampledAt === '2026-09-28T18:00:00.000Z');
  assert('active worktree usage is included in the snapshot', status.worktrees.available
    && status.worktrees.activeCount === 2 && status.worktrees.totalBytes === 7 * GIB);
}

{
  const frames = [[cpu(100, 100)], [cpu(110, 190)]];
  const status = await collectHostStatus('C:\\queue', {
    cpuSample: () => frames.shift()!,
    sleep: () => Promise.resolve(),
    totalMemory: () => 64 * GIB,
    freeMemory: () => 15 * GIB,
    linuxMeminfo: () => Promise.reject(new Error('not used')),
    platform: 'win32',
    filesystem: () => Promise.resolve({ totalBytes: 1000 * GIB, availableBytes: 211 * GIB }),
    nvidiaCsv: () => Promise.resolve({
      device: 'NVIDIA Test GPU A, 4, 2712, 32768\nNVIDIA Test GPU B, 97, 7168, 8192\n',
      processes: '101\n202\n',
    }),
    worktreeUsage: () => Promise.resolve({ available: true, activeCount: 0, totalBytes: 0 }),
    environment: {
      QUEUE_MEMORY_RESERVE_GIB: '16',
      QUEUE_DISK_FLOOR_GIB: '205',
      QUEUE_VRAM_RESERVE_GIB: '4',
      QUEUE_WORKER_LIMIT: '3',
    },
  });

  assert('all NVIDIA devices contribute to typed GPU pressure', status.gpu.available
    && status.gpu.name === '2 GPUs' && status.gpu.deviceCount === 2 && status.gpu.utilizationPercent === 97
    && status.gpu.minimumFreeBytes === GIB && status.gpu.computeProcesses === 2);
  assert('configured reserves and worker limit remain distinct', status.limits.memoryReserveBytes === 16 * GIB
    && status.limits.diskFloorBytes === 205 * GIB && status.limits.gpuVramReserveBytes === 4 * GIB
    && status.limits.workerLimit === 3);
  assert('resource guard blocks below memory reserve and per-device VRAM reserve',
    status.guard.overall === 'blocked' && status.guard.memory === 'blocked' && status.guard.gpu === 'blocked');
}

{
  const dir = mkdtempSync(join(tmpdir(), 'queue-worktree-size-'));
  writeFileSync(join(dir, 'payload.bin'), 'measured payload');
  const frames = [[cpu(100, 100)], [cpu(150, 150)]];
  const status = await collectHostStatus('/queue', {
    cpuSample: () => frames.shift()!,
    sleep: () => Promise.resolve(),
    totalMemory: () => 8 * GIB,
    freeMemory: () => 4 * GIB,
    linuxMeminfo: () => Promise.reject(new Error('fixture fallback')),
    platform: 'darwin',
    filesystem: () => Promise.resolve({ totalBytes: 20 * GIB, availableBytes: 10 * GIB }),
    nvidiaCsv: () => Promise.reject(new Error('not installed')),
    environment: {},
    sampledAt: () => 'worktree-scan',
  }, [dir]);
  rmSync(dir, { recursive: true, force: true });
  assert('real cross-platform worker measures active worktree bytes off-thread', status.worktrees.available
    && status.worktrees.activeCount === 1 && status.worktrees.totalBytes >= 'measured payload'.length);
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
    worktrees: { available: true as const, activeCount: 0, totalBytes: 0 },
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
