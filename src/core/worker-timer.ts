import type { WorkerInMessage } from './types';

// Inlined worker code as Blob URL so no separate build artifact needed
const workerCode = `
let timerId = null;
let currentIntervalMs = 100;

function runTimer(intervalMs) {
  if (timerId !== null) clearInterval(timerId);
  currentIntervalMs = intervalMs;
  timerId = setInterval(() => {
    self.postMessage({ type: 'tick' });
  }, currentIntervalMs);
}

self.onmessage = (e) => {
  const data = e.data;
  if (!data) return;

  if (data.command === 'start') {
    runTimer(data.intervalMs || 100);
  } else if (data.command === 'setInterval') {
    if (timerId !== null && data.intervalMs && data.intervalMs !== currentIntervalMs) {
      runTimer(data.intervalMs);
    }
  } else if (data.command === 'stop') {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};
`;

export class PrecisionTimer {
  private worker: Worker | null = null;
  private fallbackId: number | null = null;
  private onTick: () => void;
  private intervalMs: number;
  private backgroundIntervalMs: number;
  private currentIntervalMs: number;
  private active = false;
  private handleVisibilityChange = () => this.syncThrottling();

  constructor(onTick: () => void, intervalMs = 100, backgroundIntervalMs = 500) {
    this.onTick = onTick;
    this.intervalMs = intervalMs;
    this.backgroundIntervalMs = backgroundIntervalMs;
    this.currentIntervalMs = intervalMs;
    this.initWorker();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private initWorker(): void {
    if (typeof Worker !== 'undefined') {
      try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const w = new Worker(workerUrl);
        setTimeout(() => URL.revokeObjectURL(workerUrl), 1000);

        w.onmessage = () => {
          if (this.active) this.onTick();
        };
        w.onerror = () => {
          this.worker = null;
          if (this.active) this.startFallback();
        };
        this.worker = w;
      } catch (err) {
        console.warn('Worker initialization failed, fallback to setInterval:', err);
        this.worker = null;
      }
    }
  }

  private getEffectiveInterval(): number {
    return typeof document !== 'undefined' && document.hidden ? this.backgroundIntervalMs : this.intervalMs;
  }

  private syncThrottling(): void {
    if (!this.active) return;
    const targetInterval = this.getEffectiveInterval();
    if (targetInterval === this.currentIntervalMs) return;
    this.currentIntervalMs = targetInterval;

    if (this.worker) {
      const msg: WorkerInMessage = { command: 'setInterval', intervalMs: targetInterval };
      this.worker.postMessage(msg);
    } else if (this.fallbackId !== null) {
      this.startFallback();
    }
  }

  private startFallback(): void {
    if (this.fallbackId !== null) clearInterval(this.fallbackId);
    this.fallbackId = window.setInterval(() => {
      if (this.active) this.onTick();
    }, this.currentIntervalMs);
  }

  start(): void {
    this.active = true;
    this.currentIntervalMs = this.getEffectiveInterval();
    if (this.worker) {
      const msg: WorkerInMessage = { command: 'start', intervalMs: this.currentIntervalMs };
      this.worker.postMessage(msg);
    } else {
      this.startFallback();
    }
  }

  stop(): void {
    this.active = false;
    if (this.worker) {
      const msg: WorkerInMessage = { command: 'stop' };
      this.worker.postMessage(msg);
    }
    if (this.fallbackId !== null) {
      clearInterval(this.fallbackId);
      this.fallbackId = null;
    }
  }

  destroy(): void {
    this.stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
