import { parentPort } from 'node:worker_threads';
import { runJob, type Job } from './jobs';

/**
 * Worker entry. Bundled to plain JavaScript by the runner before it is spawned,
 * because a raw worker thread has no TypeScript or `@` alias of its own.
 */
parentPort?.on('message', (message: { start: number; jobs: Job[] }) => {
  parentPort?.postMessage({ start: message.start, outcomes: message.jobs.map(runJob) });
});
