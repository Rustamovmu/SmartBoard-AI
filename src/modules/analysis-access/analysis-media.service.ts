import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Writable, Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  MEDIA_LIMITS,
  integerIn,
  jpegDimensions,
  record,
  strictJson,
  validMeasurements,
  type MediaFrame,
  type MediaResult,
} from '../../contracts/analysis-media-v2';
import { AnalysisConfig } from './analysis.config';
import {
  AnalysisBusyException,
  MediaValidationError,
  VisionUnavailableException,
} from './analysis.errors';

type Child = ChildProcessByStdio<Writable, Readable, null>;
interface Job {
  id: string;
  control: AbortController;
  external: AbortSignal;
  abort: () => void;
  timer: ReturnType<typeof setTimeout>;
  resolve?: (result: MediaResult) => void;
  reject?: (error: Error) => void;
  frame?: Pick<MediaFrame, 'width' | 'height' | 'corners'>;
  input?: Buffer;
  complete: boolean;
}
interface Slot {
  child: Child;
  ready: boolean;
  retiring: boolean;
  replacement: boolean;
  storage: Buffer;
  used: number;
  total?: number;
  header?: Record<string, unknown>;
  startup: ReturnType<typeof setTimeout>;
  closed: Promise<void>;
  job?: Job;
}
export interface MediaLease {
  signal: AbortSignal;
  run(frame: MediaFrame): Promise<MediaResult>;
  release(): void;
  cancel(): void;
}

@Injectable()
export class AnalysisMediaService implements OnModuleDestroy {
  private readonly slots = new Set<Slot>();
  private readonly replacements = new Set<ReturnType<typeof setTimeout>>();
  private stopping = false;
  private started = false;
  constructor(private readonly config: AnalysisConfig) {}
  get available(): boolean {
    return [...this.slots].some((slot) => slot.ready && !slot.retiring);
  }
  get processCount(): number {
    return this.slots.size;
  }
  get busyCount(): number {
    return [...this.slots].filter((slot) => !!slot.job).length;
  }

  /** Called by the HTTP transport only. CLI application contexts never spawn. */
  start() {
    if (this.started || this.stopping || !this.config.mediaEnabled) return;
    this.started = true;
    for (let i = 0; i < MEDIA_LIMITS.workers; i++) this.launch();
  }
  async waitUntilReady(): Promise<void> {
    const deadline = Date.now() + MEDIA_LIMITS.startupMs + 500;
    while (!this.available && !this.stopping && Date.now() < deadline) {
      if (this.started && !this.slots.size && !this.replacements.size) break;
      await new Promise((done) => setTimeout(done, 25));
    }
    if (!this.available) throw new VisionUnavailableException();
  }
  private launch() {
    if (this.stopping || this.slots.size >= MEDIA_LIMITS.workers) return;
    const child = spawn(
      this.config.pythonExecutable,
      [
        '-I',
        '-B',
        '-u',
        resolve(this.config.projectRoot, 'vision/scripts/bridge_worker.py'),
      ],
      {
        cwd: this.config.projectRoot,
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: {
          PATH: '/usr/bin:/bin',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUNBUFFERED: '1',
          OPENCV_IO_MAX_IMAGE_PIXELS: '16000000',
          OMP_NUM_THREADS: '2',
          OPENBLAS_NUM_THREADS: '2',
          MKL_NUM_THREADS: '2',
          VECLIB_MAXIMUM_THREADS: '2',
        },
      },
    );
    let done: () => void = () => undefined;
    const slot: Slot = {
      child,
      ready: false,
      retiring: false,
      replacement: false,
      storage: Buffer.alloc(MEDIA_LIMITS.resultBytes),
      used: 0,
      startup: setTimeout(
        () => this.retire(slot, false),
        MEDIA_LIMITS.startupMs,
      ),
      closed: new Promise<void>((resolveClosed) => {
        done = resolveClosed;
      }),
    };
    this.slots.add(slot);
    child.on('error', () => this.retire(slot, false));
    child.stdin.on('error', () => this.retire(slot, slot.ready));
    child.stdout.on('error', () => this.retire(slot, slot.ready));
    child.stdout.on('data', (chunk: Buffer) => this.receive(slot, chunk));
    child.once('close', () => {
      this.retire(slot, slot.ready);
      this.slots.delete(slot);
      slot.storage.fill(0);
      done();
      if (slot.replacement && !this.stopping) {
        const timer = setTimeout(() => {
          this.replacements.delete(timer);
          this.launch();
        }, MEDIA_LIMITS.replacementMs);
        this.replacements.add(timer);
      }
    });
  }
  private receive(slot: Slot, chunk: Buffer) {
    try {
      if (slot.retiring) return;
      if (
        (slot.ready && (!slot.job?.frame || slot.job.complete)) ||
        chunk.length > slot.storage.length - slot.used
      )
        throw new Error();
      chunk.copy(slot.storage, slot.used);
      slot.used += chunk.length;
      if (slot.used < 4) return;
      const headerLength = slot.storage.readUInt32BE(0);
      if (!integerIn(headerLength, 1, MEDIA_LIMITS.resultHeaderBytes))
        throw new Error();
      if (slot.used < headerLength + 4) return;
      if (!slot.header) {
        const header = strictJson(slot.storage.subarray(4, headerLength + 4));
        if (!slot.ready) {
          if (
            !record(header, ['protocolVersion', 'type', 'vision']) ||
            header.protocolVersion !== 1 ||
            header.type !== 'ready' ||
            header.vision !== true ||
            slot.used !== headerLength + 4
          )
            throw new Error();
          slot.ready = true;
          clearTimeout(slot.startup);
          slot.storage.fill(0);
          slot.used = 0;
          return;
        }
        const job = slot.job;
        if (
          job &&
          record(header, ['protocolVersion', 'type', 'requestId', 'code']) &&
          header.protocolVersion === 1 &&
          header.type === 'error' &&
          header.requestId === job.id &&
          header.code === 'VALIDATION_ERROR'
        ) {
          this.retire(slot, true, new MediaValidationError());
          return;
        }
        if (
          !job?.frame ||
          !record(header, [
            'protocolVersion',
            'type',
            'requestId',
            'rectifiedBytes',
            'enhancedBytes',
            'measurements',
          ]) ||
          header.protocolVersion !== 1 ||
          header.type !== 'result' ||
          header.requestId !== job.id ||
          !integerIn(header.rectifiedBytes, 1, MEDIA_LIMITS.jpegBytes) ||
          !integerIn(header.enhancedBytes, 1, MEDIA_LIMITS.jpegBytes) ||
          !validMeasurements(header.measurements, job.frame)
        )
          throw new Error();
        slot.header = header;
        slot.total =
          headerLength + 4 + header.rectifiedBytes + header.enhancedBytes;
      }
      if (slot.used > slot.total!) throw new Error();
      if (slot.used < slot.total!) return;
      const header = slot.header;
      const job = slot.job!;
      const offset = headerLength + 4;
      const rectified = slot.storage.subarray(
        offset,
        offset + (header.rectifiedBytes as number),
      );
      const enhanced = slot.storage.subarray(
        offset + rectified.length,
        slot.used,
      );
      const measurements = header.measurements as Record<string, unknown>;
      if (
        !jpegDimensions(
          rectified,
          measurements.rectified_width as number,
          measurements.rectified_height as number,
        ) ||
        !jpegDimensions(
          enhanced,
          measurements.rectified_width as number,
          measurements.rectified_height as number,
        )
      )
        throw new Error();
      job.complete = true;
      job.resolve!({ measurements, rectified, enhanced });
    } catch {
      this.retire(slot, slot.ready);
    } finally {
      chunk.fill(0);
    }
  }
  acquire(external: AbortSignal): MediaLease {
    if (this.stopping || !this.config.mediaEnabled || external.aborted)
      throw new VisionUnavailableException();
    const slot = [...this.slots].find(
      (slot) => slot.ready && !slot.retiring && !slot.job,
    );
    if (!slot) {
      if (!this.available) throw new VisionUnavailableException();
      throw new AnalysisBusyException();
    }
    const job: Job = {
      id: randomUUID(),
      control: new AbortController(),
      external,
      abort: () => this.retire(slot, true),
      complete: false,
      timer: setTimeout(() => this.retire(slot, true), MEDIA_LIMITS.jobMs),
    };
    slot.job = job;
    external.addEventListener('abort', job.abort, { once: true });
    return {
      signal: job.control.signal,
      run: (frame) =>
        new Promise<MediaResult>((resolveJob, reject) => {
          if (
            slot.job !== job ||
            job.frame ||
            job.control.signal.aborted ||
            external.aborted
          ) {
            reject(new VisionUnavailableException());
            return;
          }
          job.resolve = resolveJob;
          job.reject = reject;
          job.frame = {
            width: frame.width,
            height: frame.height,
            corners: frame.corners,
          };
          const header = Buffer.from(
            JSON.stringify({
              protocolVersion: 1,
              type: 'frame',
              requestId: job.id,
              width: frame.width,
              height: frame.height,
              corners: frame.corners,
              jpegBytes: frame.jpeg.length,
            }),
          );
          const prefix = Buffer.alloc(4);
          prefix.writeUInt32BE(header.length);
          const packet = Buffer.concat([prefix, header, frame.jpeg]);
          job.input = packet;
          slot.child.stdin.write(packet, (error) => {
            packet.fill(0);
            if (job.input === packet) job.input = undefined;
            if (error) this.retire(slot, true);
          });
        }),
      release: () => {
        if (slot.job !== job || slot.retiring) return;
        if (!job.complete) {
          this.retire(slot, true);
          return;
        }
        this.clearJob(slot);
        slot.storage.fill(0);
        slot.used = 0;
        slot.header = undefined;
        slot.total = undefined;
      },
      cancel: () => {
        if (slot.job === job) this.retire(slot, true);
      },
    };
  }
  private clearJob(slot: Slot) {
    const job = slot.job;
    if (!job) return;
    clearTimeout(job.timer);
    job.external.removeEventListener('abort', job.abort);
    job.input?.fill(0);
    job.input = undefined;
    job.frame = undefined;
    slot.job = undefined;
  }
  private retire(
    slot: Slot,
    replacement: boolean,
    reason: Error = new VisionUnavailableException(),
  ) {
    if (slot.retiring) return;
    slot.retiring = true;
    slot.replacement = replacement;
    clearTimeout(slot.startup);
    const job = slot.job;
    if (job) {
      job.control.abort(reason);
      job.reject?.(reason);
      this.clearJob(slot);
    }
    slot.storage.fill(0);
    slot.used = 0;
    slot.header = undefined;
    // Never free the physical slot until close: a kill request is not an exit.
    slot.child.kill('SIGKILL');
    slot.child.stdin.destroy();
    slot.child.stdout.destroy();
  }
  async onModuleDestroy() {
    this.stopping = true;
    for (const timer of this.replacements) clearTimeout(timer);
    this.replacements.clear();
    const slots = [...this.slots];
    for (const slot of slots) this.retire(slot, false);
    await Promise.all(slots.map((slot) => slot.closed));
  }
}
