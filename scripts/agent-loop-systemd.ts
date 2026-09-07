// Transient user units provide recurrence, non-overlap and process-group limits.
import { spawnSync } from 'node:child_process';
import type { Config } from './agent-loop-state.ts';

const CONTROL_TIMEOUT = 15_000;
export function control(args: string[], allowFailure = false): string {
  const result = spawnSync('systemctl', ['--user', ...args], {
    encoding: 'utf8', timeout: CONTROL_TIMEOUT,
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new Error(`systemd user manager: ${result.error?.message || result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function available(): void {
  if (process.platform !== 'linux') throw new Error('External loops require Linux with a running systemd user manager');
  control(['show-environment']);
}

export function unitState(unit: string): string {
  return control(['show', unit, '--property=ActiveState', '--value'], true) || 'inactive';
}

export function busy(state: string): boolean {
  return ['active', 'activating', 'deactivating', 'reloading'].includes(state);
}

export function arm(config: Config, dir: string, script: string): void {
  const result = spawnSync('systemd-run', [
    '--user', '--quiet', `--unit=${config.unit}`, '--expand-environment=no',
    '--on-active=1s', `--on-unit-inactive=${config.interval}ms`,
    '--timer-property=AccuracySec=1ms', '--timer-property=RemainAfterElapse=no',
    '--property=Type=exec', '--property=KillMode=control-group',
    `--property=RuntimeMaxSec=${config.timeout}ms`, '--property=TimeoutStopSec=2s',
    '--property=Restart=no', '--property=UMask=0077',
    '--', process.execPath, script, 'timer-run', '--state', dir, '--generation', config.generation,
  ], { encoding: 'utf8', timeout: CONTROL_TIMEOUT });
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot arm loop: ${result.error?.message || result.stderr.trim()}`);
  }
  if (unitState(`${config.unit}.timer`) !== 'active') throw new Error('Timer activation could not be verified');
}
