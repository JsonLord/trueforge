import { createNeedleClient } from '../adapter/client.mjs';
import { benchmarkRetrieval, retrievalFixtures, retrievalTools } from './retrieval.mjs';

const client = createNeedleClient({ url: process.env.NEEDLE_URL ?? 'http://127.0.0.1:8792' });
const result = await benchmarkRetrieval({ client, fixtures: retrievalFixtures, tools: retrievalTools, topK: 3 });
console.log(JSON.stringify(result, null, 2));
if (result.embeddingErrors > 0) process.exitCode = 1;
