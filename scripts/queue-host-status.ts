// queue-host-status.ts — bounded, read-only host measurements for the queue console.

import { statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem, type CpuInfo } from 'node:os';

const CPU_SAMPLE_MS = 100;

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
}

export interface HostProbeDependencies {
  cpuSample: () => CpuInfo[];
  sleep: (milliseconds: number) => Promise<void>;
  totalMemory: () => number;
  availableMemory: () => number;
  filesystem: (path: string) => Promise<{ totalBytes: number; availableBytes: number }>;
  gpu: () => Promise<GpuMetric>;
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

function defaultFilesystem(path: string): Promise<{ totalBytes: number; availableBytes: number }> {
  return statfs(path, { bigint: true }).then(stats => ({
    totalBytes: Number(stats.blocks * stats.bsize),
    availableBytes: Number(stats.bavail * stats.bsize),
  }));
}

function unavailableGpu(): Promise<GpuMetric> {
  return Promise.resolve({ available: false, reason: 'GPU probe not implemented' });
}

const DEFAULT_DEPENDENCIES: HostProbeDependencies = {
  cpuSample: cpus,
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  totalMemory: totalmem,
  availableMemory: freemem,
  filesystem: defaultFilesystem,
  gpu: unavailableGpu,
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
  await dependencies.sleep(CPU_SAMPLE_MS);
  const [disk, gpu] = await Promise.all([diskPromise, dependencies.gpu()]);
  return {
    sampledAt: dependencies.sampledAt(),
    cpu: cpuUtilization(before, dependencies.cpuSample()),
    memory: {
      totalBytes: dependencies.totalMemory(),
      availableBytes: dependencies.availableMemory(),
    },
    disk,
    gpu,
  };
}
