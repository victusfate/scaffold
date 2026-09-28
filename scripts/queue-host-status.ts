// queue-host-status.ts — bounded, read-only host measurements for the queue console.

import { execFile } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem, type CpuInfo } from 'node:os';
import { join } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const CPU_SAMPLE_MS = 100;
const GPU_TIMEOUT_MS = 1000;
const WORKTREE_TIMEOUT_MS = 1500;
const HOST_METRIC_TIMEOUT_MS = 2000;
const HOST_CACHE_MS = 2000;
const PERCENT = 100;
const PERCENT_TENTHS = 10;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const KIB = 1024;
const POSIX_BLOCK_BYTES = 512;
const DEFAULT_MEMORY_RESERVE_GIB = 4;
const DEFAULT_DISK_FLOOR_GIB = 20;
const DEFAULT_VRAM_RESERVE_GIB = 4;
const CPU_WARN_PERCENT = 75;
const CPU_BLOCK_PERCENT = 90;
const HEADROOM_WARN_RATIO = 1.25;

type Guard = 'clear' | 'warn' | 'blocked' | 'unavailable';

type CpuMetric = {
  available: true;
  cores: number;
  utilizationPercent: number;
} | {
  available: false;
  reason: string;
};

type DiskMetric = {
  available: true;
  path: string;
  totalBytes: number;
  availableBytes: number;
} | {
  available: false;
  path: string;
  reason: string;
};

type GpuMetric = {
  available: true;
  name: string;
  deviceCount: number;
  utilizationPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  minimumFreeBytes: number;
  computeProcesses: number;
} | {
  available: false;
  reason: string;
};

type WorktreeMetric = {
  available: true;
  activeCount: number;
  totalBytes: number;
} | {
  available: false;
  activeCount: number;
  reason: string;
};

interface WorktreeWorkerData {
  operation: 'measure-worktrees';
  paths: string[];
}

export interface HostStatus {
  sampledAt: string;
  cpu: CpuMetric;
  memory: { totalBytes: number; availableBytes: number };
  disk: DiskMetric;
  gpu: GpuMetric;
  worktrees: WorktreeMetric;
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
  freeMemory: () => number;
  linuxMeminfo: () => Promise<string>;
  platform: NodeJS.Platform;
  filesystem: (path: string) => Promise<{ totalBytes: number; availableBytes: number }>;
  nvidiaCsv: () => Promise<{ device: string; processes: string }>;
  worktreeUsage: (paths: string[]) => Promise<WorktreeMetric>;
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
  const utilizationPercent = Math.round((1 - idle / elapsed) * PERCENT * PERCENT_TENTHS)
    / PERCENT_TENTHS;
  return { available: true, cores: after.length, utilizationPercent };
}

function runNvidia(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error: Error | null, stdout = ''): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    const child = execFile('nvidia-smi', args, { encoding: 'utf8', windowsHide: true },
      (error, stdout) => finish(error ? new Error('nvidia-smi failed', { cause: error }) : null, stdout));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      finish(new Error(`nvidia-smi timed out after ${GPU_TIMEOUT_MS}ms`));
    }, GPU_TIMEOUT_MS);
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
  const devices = device.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const [name, utilization, memoryUsed, memoryTotal] = line.split(',').map(value => value.trim());
    return { name, utilization: Number(utilization), used: Number(memoryUsed), total: Number(memoryTotal) };
  });
  if (!devices.length || devices.some(gpu => !gpu.name
    || [gpu.utilization, gpu.used, gpu.total].some(value => !Number.isFinite(value)))) {
    return { available: false, reason: 'nvidia-smi returned an unexpected response' };
  }
  const memoryUsedBytes = devices.reduce((sum, gpu) => sum + gpu.used * MIB, 0);
  const memoryTotalBytes = devices.reduce((sum, gpu) => sum + gpu.total * MIB, 0);
  return {
    available: true,
    name: devices.length === 1 ? devices[0].name : `${devices.length} GPUs`,
    deviceCount: devices.length,
    utilizationPercent: Math.max(...devices.map(gpu => gpu.utilization)),
    memoryUsedBytes,
    memoryTotalBytes,
    minimumFreeBytes: Math.min(...devices.map(gpu => (gpu.total - gpu.used) * MIB)),
    computeProcesses: processes.split(/\r?\n/).filter(line => line.trim()).length,
  };
}

function allocatedBytes(root: string): number {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const path = pending.pop()!;
    const stats = lstatSync(path);
    const hasAllocatedBlocks = process.platform !== 'win32' && Number.isFinite(stats.blocks);
    total += hasAllocatedBlocks ? stats.blocks * POSIX_BLOCK_BYTES : stats.size;
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      pending.push(...readdirSync(path).map(name => join(path, name)));
    }
  }
  return total;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(
      new Error(`${label} timed out after ${HOST_METRIC_TIMEOUT_MS}ms`)), HOST_METRIC_TIMEOUT_MS);
    promise.then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function measureWorktrees(paths: string[]): WorktreeMetric {
  return {
    available: true,
    activeCount: paths.length,
    totalBytes: paths.reduce((sum, path) => sum + allocatedBytes(path), 0),
  };
}

async function defaultWorktreeUsage(paths: string[]): Promise<WorktreeMetric> {
  if (!paths.length) return { available: true, activeCount: 0, totalBytes: 0 };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { operation: 'measure-worktrees', paths },
    });
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      reject(new Error(`worktree scan timed out after ${WORKTREE_TIMEOUT_MS}ms`));
    }, WORKTREE_TIMEOUT_MS);
    worker.once('message', (metric: WorktreeMetric) => {
      clearTimeout(timer);
      resolve(metric);
    });
    worker.once('error', error => {
      clearTimeout(timer);
      reject(new Error('worktree scan failed', { cause: error }));
    });
  });
}

function isWorktreeWorkerData(value: unknown): value is WorktreeWorkerData {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.operation === 'measure-worktrees'
    && Array.isArray(record.paths) && record.paths.every(path => typeof path === 'string');
}

function defaultFilesystem(path: string): Promise<{ totalBytes: number; availableBytes: number }> {
  return statfs(path, { bigint: true }).then(stats => ({
    totalBytes: Number(stats.blocks * stats.bsize),
    availableBytes: Number(stats.bavail * stats.bsize),
  }));
}

async function defaultAvailableMemory(dependencies: HostProbeDependencies): Promise<number> {
  if (dependencies.platform === 'linux') {
    try {
      const meminfo = await withTimeout(dependencies.linuxMeminfo(), 'Linux memory probe');
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
      if (match) return Number(match[1]) * KIB;
    } catch { /* fall through to the portable conservative value */ }
  }
  return dependencies.freeMemory();
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

function cpuGuard(cpu: CpuMetric): Guard {
  if (!cpu.available) return 'unavailable';
  if (cpu.utilizationPercent >= CPU_BLOCK_PERCENT) return 'blocked';
  if (cpu.utilizationPercent >= CPU_WARN_PERCENT) return 'warn';
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
  freeMemory: freemem,
  linuxMeminfo: () => readFile('/proc/meminfo', 'utf8'),
  platform: process.platform,
  filesystem: defaultFilesystem,
  nvidiaCsv: defaultNvidiaCsv,
  worktreeUsage: defaultWorktreeUsage,
  environment: process.env,
  sampledAt: () => new Date().toISOString(),
};

/** Collect one host snapshot. Unsupported metrics fail independently. */
export async function collectHostStatus(
  root: string,
  overrides: Partial<HostProbeDependencies> = {},
  worktreePaths: string[] = [],
): Promise<HostStatus> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const before = dependencies.cpuSample();
  const diskPromise = withTimeout(dependencies.filesystem(root), 'filesystem probe')
    .then<DiskMetric>(disk => ({ available: true, path: root, ...disk }))
    .catch((error: unknown): DiskMetric => ({
      available: false, path: root, reason: (error as Error).message,
    }));
  const gpuPromise = withTimeout(dependencies.nvidiaCsv(), 'GPU probe')
    .then(parseGpu)
    .catch((error: unknown): GpuMetric => ({ available: false, reason: (error as Error).message }));
  const worktreePromise = withTimeout(dependencies.worktreeUsage(worktreePaths), 'worktree probe')
    .catch((error: unknown): WorktreeMetric => ({
      available: false, activeCount: worktreePaths.length, reason: (error as Error).message,
    }));
  const memoryPromise = defaultAvailableMemory(dependencies);
  await dependencies.sleep(CPU_SAMPLE_MS);
  const [disk, gpu, worktrees, availableBytes] = await Promise.all([
    diskPromise, gpuPromise, worktreePromise, memoryPromise,
  ]);
  const cpu = cpuUtilization(before, dependencies.cpuSample());
  const memory = {
    totalBytes: dependencies.totalMemory(),
    availableBytes,
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
    cpu: cpuGuard(cpu),
    memory: lowHeadroomGuard(memory.availableBytes, limits.memoryReserveBytes),
    disk: disk.available ? lowHeadroomGuard(disk.availableBytes, limits.diskFloorBytes) : 'unavailable' as const,
    gpu: gpu.available
      ? lowHeadroomGuard(gpu.minimumFreeBytes, limits.gpuVramReserveBytes)
      : 'unavailable' as const,
  };
  return {
    sampledAt: dependencies.sampledAt(),
    cpu,
    memory,
    disk,
    gpu,
    worktrees,
    limits,
    guard: { ...guard, overall: overallGuard(Object.values(guard)) },
  };
}

/** Coalesce concurrent refreshes and reuse a recent snapshot. Failures are never cached. */
export function createCachedHostProbe(
  probe: () => Promise<HostStatus>,
  cacheMilliseconds = HOST_CACHE_MS,
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

if (!isMainThread && isWorktreeWorkerData(workerData)) {
  parentPort?.postMessage(measureWorktrees(workerData.paths));
}
