// queue-host-status.ts — bounded, read-only host measurements for the queue console.

import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem, type CpuInfo } from 'node:os';

const CPU_SAMPLE_MS = 100;
const GPU_TIMEOUT_MS = 1000;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const DEFAULT_MEMORY_RESERVE_GIB = 4;
const DEFAULT_DISK_FLOOR_GIB = 20;
const DEFAULT_VRAM_RESERVE_GIB = 4;
const CPU_WARN_PERCENT = 75;
const CPU_BLOCK_PERCENT = 90;
const HEADROOM_WARN_RATIO = 1.25;

export type Guard = 'clear' | 'warn' | 'blocked' | 'unavailable';

export type CpuMetric = {
  available: true;
  cores: number;
  utilizationPercent: number;
} | {
  available: false;
  reason: string;
};

export type DiskMetric = {
  available: true;
  path: string;
  totalBytes: number;
  availableBytes: number;
} | {
  available: false;
  path: string;
  reason: string;
};

export type GpuMetric = {
  available: true;
  name: string;
  utilizationPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  computeProcesses: number;
} | {
  available: false;
  reason: string;
};

export interface HostStatus {
  sampledAt: string;
  cpu: CpuMetric;
  memory: { totalBytes: number; availableBytes: number };
  disk: DiskMetric;
  gpu: GpuMetric;
  limits: {
    memoryReserveBytes: number;
    diskFloorBytes: number;
    gpuVramReserveBytes: number;
    workerLimit: number | null;
  };
  guard: { overall: Guard; cpu: Guard; memory: Guard; disk: Guard; gpu: Guard };
}

export interface HostProbeDependencies {
  cpuSample: () => CpuInfo[];
  sleep: (milliseconds: number) => Promise<void>;
  totalMemory: () => number;
  availableMemory: () => number;
  filesystem: (path: string) => Promise<{ totalBytes: number; availableBytes: number }>;
  nvidiaCsv: () => Promise<{ device: string; processes: string }>;
  environment: Record<string, string | undefined>;
  sampledAt: () => string;
}

function totalCpuTime(cpu: CpuInfo): number {
  return Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
}

function cpuUtilization(before: CpuInfo[], after: CpuInfo[]): CpuMetric {
  if (!before.length || before.length !== after.length) {
    return { available: false, reason: 'CPU samples unavailable' };
  }
  const elapsed = after.reduce((sum, cpu, index) =>
    sum + totalCpuTime(cpu) - totalCpuTime(before[index]), 0);
  const idle = after.reduce((sum, cpu, index) =>
    sum + cpu.times.idle - before[index].times.idle, 0);
  if (elapsed <= 0) return { available: false, reason: 'CPU sample interval had no elapsed time' };
  const utilizationPercent = Math.round((1 - idle / elapsed) * 1000) / 10;
  return { available: true, cores: after.length, utilizationPercent };
}

function runNvidia(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('nvidia-smi', args, { encoding: 'utf8', timeout: GPU_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => error ? reject(new Error('nvidia-smi failed', { cause: error })) : resolve(stdout));
  });
}

async function defaultNvidiaCsv(): Promise<{ device: string; processes: string }> {
  const [device, processes] = await Promise.all([
    runNvidia(['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']),
    runNvidia(['--query-compute-apps=pid', '--format=csv,noheader,nounits']),
  ]);
  return { device, processes };
}

function parseGpu({ device, processes }: { device: string; processes: string }): GpuMetric {
  const [name, utilization, memoryUsed, memoryTotal] = device.split(/\r?\n/, 1)[0]
    .split(',').map(value => value.trim());
  const values = [utilization, memoryUsed, memoryTotal].map(Number);
  if (!name || values.some(value => !Number.isFinite(value))) {
    return { available: false, reason: 'nvidia-smi returned an unexpected response' };
  }
  return {
    available: true,
    name,
    utilizationPercent: values[0],
    memoryUsedBytes: values[1] * MIB,
    memoryTotalBytes: values[2] * MIB,
    computeProcesses: processes.split(/\r?\n/).filter(line => line.trim()).length,
  };
}

function defaultFilesystem(path: string): Promise<{ totalBytes: number; availableBytes: number }> {
  return statfs(path, { bigint: true }).then(stats => ({
    totalBytes: Number(stats.blocks * stats.bsize),
    availableBytes: Number(stats.bavail * stats.bsize),
  }));
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function workerLimit(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function lowHeadroomGuard(available: number, floor: number): Guard {
  if (available < floor) return 'blocked';
  if (available < floor * HEADROOM_WARN_RATIO) return 'warn';
  return 'clear';
}

function overallGuard(guards: Guard[]): Guard {
  if (guards.includes('blocked')) return 'blocked';
  if (guards.includes('warn')) return 'warn';
  return 'clear';
}

const DEFAULT_DEPENDENCIES: HostProbeDependencies = {
  cpuSample: cpus,
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  totalMemory: totalmem,
  availableMemory: freemem,
  filesystem: defaultFilesystem,
  nvidiaCsv: defaultNvidiaCsv,
  environment: process.env,
  sampledAt: () => new Date().toISOString(),
};

/** Collect one host snapshot. Unsupported metrics fail independently. */
export async function collectHostStatus(
  root: string,
  overrides: Partial<HostProbeDependencies> = {},
): Promise<HostStatus> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const before = dependencies.cpuSample();
  const diskPromise = dependencies.filesystem(root)
    .then<DiskMetric>(disk => ({ available: true, path: root, ...disk }))
    .catch((error: unknown): DiskMetric => ({
      available: false, path: root, reason: (error as Error).message,
    }));
  const gpuPromise = dependencies.nvidiaCsv()
    .then(parseGpu)
    .catch((error: unknown): GpuMetric => ({ available: false, reason: (error as Error).message }));
  await dependencies.sleep(CPU_SAMPLE_MS);
  const [disk, gpu] = await Promise.all([diskPromise, gpuPromise]);
  const cpu = cpuUtilization(before, dependencies.cpuSample());
  const memory = {
    totalBytes: dependencies.totalMemory(),
    availableBytes: dependencies.availableMemory(),
  };
  const limits = {
    memoryReserveBytes: positiveNumber(dependencies.environment.QUEUE_MEMORY_RESERVE_GIB,
      DEFAULT_MEMORY_RESERVE_GIB) * GIB,
    diskFloorBytes: positiveNumber(dependencies.environment.QUEUE_DISK_FLOOR_GIB,
      DEFAULT_DISK_FLOOR_GIB) * GIB,
    gpuVramReserveBytes: positiveNumber(dependencies.environment.QUEUE_VRAM_RESERVE_GIB,
      DEFAULT_VRAM_RESERVE_GIB) * GIB,
    workerLimit: workerLimit(dependencies.environment.QUEUE_WORKER_LIMIT),
  };
  const guard = {
    cpu: cpu.available
      ? cpu.utilizationPercent >= CPU_BLOCK_PERCENT ? 'blocked' as const
        : cpu.utilizationPercent >= CPU_WARN_PERCENT ? 'warn' as const : 'clear' as const
      : 'unavailable' as const,
    memory: lowHeadroomGuard(memory.availableBytes, limits.memoryReserveBytes),
    disk: disk.available ? lowHeadroomGuard(disk.availableBytes, limits.diskFloorBytes) : 'unavailable' as const,
    gpu: gpu.available
      ? lowHeadroomGuard(gpu.memoryTotalBytes - gpu.memoryUsedBytes, limits.gpuVramReserveBytes)
      : 'unavailable' as const,
  };
  return {
    sampledAt: dependencies.sampledAt(),
    cpu,
    memory,
    disk,
    gpu,
    limits,
    guard: { ...guard, overall: overallGuard(Object.values(guard)) },
  };
}

/** Coalesce concurrent refreshes and reuse a recent snapshot. Failures are never cached. */
export function createCachedHostProbe(
  probe: () => Promise<HostStatus>,
  cacheMilliseconds = 2000,
  clock: () => number = Date.now,
): () => Promise<HostStatus> {
  let cached: HostStatus | null = null;
  let expiresAt = 0;
  let inFlight: Promise<HostStatus> | null = null;
  return () => {
    if (cached && clock() < expiresAt) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = probe().then(status => {
      cached = status;
      expiresAt = clock() + cacheMilliseconds;
      return status;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
