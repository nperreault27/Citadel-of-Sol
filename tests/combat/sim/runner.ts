import { availableParallelism } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { build } from 'vite';
import { runJob, type Job, type Outcome } from './jobs';

/**
 * Runs battles across a few cores, not all of them.
 *
 * The planner is a few hundred times the work of the greedy AI, and the swing
 * grid is tens of thousands of battles, so one thread is not an option. Vitest's
 * transform does not reach into `worker_threads`, so the worker is bundled to
 * plain JavaScript first — engine, content and AI in one file.
 *
 * `PROBE_WORKERS=1` skips all of it and runs in-process, which is the thing to
 * reach for when a stack trace matters more than the wait.
 */

/** Jobs sent per message: small enough to share out slow battles evenly. */
const CHUNK = 8;

/**
 * A quarter of the cores, and never more than three.
 *
 * A probe runs for minutes, and holding every core at full load that long
 * overheated a machine badly enough to shut it down. Slower and cool beats fast
 * and off; `PROBE_WORKERS` raises it on a machine that can take it.
 */
const MAX_DEFAULT_THREADS = 3;

function defaultThreads(): number {
  return Math.min(MAX_DEFAULT_THREADS, Math.max(1, Math.floor(availableParallelism() / 4)));
}

async function bundleWorker(): Promise<string> {
  const root = process.cwd();
  const outDir = path.join(root, 'node_modules', '.cache', 'probe-sim');

  await build({
    configFile: false,
    logLevel: 'warn',
    root,
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: {
      ssr: path.join(root, 'tests', 'combat', 'sim', 'worker.ts'),
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'worker.mjs' } },
    },
  });

  return path.join(outDir, 'worker.mjs');
}

export async function runBattles(jobs: readonly Job[], label: string): Promise<Outcome[]> {
  const threads = Number(process.env.PROBE_WORKERS) || defaultThreads();
  const started = Date.now();

  if (threads <= 1) return jobs.map(runJob);

  const file = await bundleWorker();
  const outcomes: Outcome[] = new Array<Outcome>(jobs.length);
  let next = 0;
  let done = 0;
  let reported = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(threads, Math.ceil(jobs.length / CHUNK)) },
      () =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(file);

          const send = () => {
            if (next >= jobs.length) {
              void worker.terminate().then(() => resolve());
              return;
            }
            const start = next;
            const batch = jobs.slice(start, start + CHUNK);
            next += batch.length;
            worker.postMessage({ start, jobs: batch });
          };

          worker.on('message', (message: { start: number; outcomes: Outcome[] }) => {
            message.outcomes.forEach((outcome, i) => {
              outcomes[message.start + i] = outcome;
            });
            done += message.outcomes.length;

            const tenth = Math.floor((done / jobs.length) * 10);
            if (tenth > reported) {
              reported = tenth;
              const seconds = ((Date.now() - started) / 1000).toFixed(0);
              process.stderr.write(`  ${label}: ${tenth * 10}% (${seconds}s)\n`);
            }

            send();
          });
          worker.on('error', reject);

          send();
        })
    )
  );

  return outcomes;
}
