import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNeedleLiveEvaluation } from '../dist/core/index.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const modulePath = process.env['NEEDLE_EVAL_CLIENT_MODULE'];
if (!modulePath) {
  throw new Error('NEEDLE_EVAL_CLIENT_MODULE must point to an ESM module exporting classifier');
}
const runs = Number(argument('--runs', '1'));
const timeoutMs = Number(argument('--timeout-ms', '3000'));
const outputRoot = argument('--output', resolve(process.cwd(), '../../artifacts/needle-eval'));
const loaded = await import(pathToFileURL(resolve(modulePath)).href);
const classifier =
  typeof loaded.createClassifier === 'function' ? await loaded.createClassifier({ timeoutMs }) : loaded.classifier;
if (!classifier || typeof classifier.classify !== 'function') {
  throw new Error('Needle evaluation module must export classifier or createClassifier({ timeoutMs })');
}

const timestamp = new Date().toISOString();
const result = await runNeedleLiveEvaluation({ classifier, runs });
const safeTimestamp = timestamp.replaceAll(':', '-');
const outputDirectory = resolve(outputRoot, safeTimestamp);
await mkdir(outputDirectory, { recursive: true });
const metadata = {
  timestamp,
  provider: typeof loaded.provider === 'string' ? loaded.provider : 'needle',
  model: typeof loaded.model === 'string' ? loaded.model : 'unknown',
  commit: process.env['GIT_COMMIT'] ?? 'unknown',
  runs,
  timeoutMs,
};
await Promise.all([
  writeFile(
    resolve(outputDirectory, 'classification.json'),
    JSON.stringify({ metadata, runs: result.classificationRuns, stability: result.stability }, null, 2),
  ),
  writeFile(
    resolve(outputDirectory, 'fast-path-admission.json'),
    JSON.stringify({ metadata, runs: result.admissionRuns, thresholdSimulation: result.thresholdSimulation }, null, 2),
  ),
  writeFile(resolve(outputDirectory, 'summary.json'), JSON.stringify({ metadata, ...result }, null, 2)),
]);

if (result.providerFailureCount === (42 + 36) * runs) {
  throw new Error(`All Needle classification requests failed; diagnostics written to ${outputDirectory}`);
}

process.stdout.write(
  `${JSON.stringify({
    outputDirectory,
    provider: metadata.provider,
    model: metadata.model,
    runs,
    providerFailureCount: result.providerFailureCount,
    unsafeReadMisclassificationCount: result.unsafeReadMisclassificationCount,
    unsafeEligibleCount: result.unsafeEligibleCount,
    toolAvailabilityDifferenceCount: result.toolAvailabilityDifferenceCount,
    unstableCases: result.stability.filter(entry => entry.unstable).map(entry => entry.caseId),
    thresholdSimulation: result.thresholdSimulation,
  }, null, 2)}\n`,
);
