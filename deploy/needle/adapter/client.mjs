const COMPLEXITIES = new Set(['simple', 'reasoning', 'unknown']);
const ACTION_CLASSES = new Set(['read', 'write', 'destructive', 'external_side_effect', 'unknown']);

function objectValue(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function confidenceValue(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('confidence must be finite and between zero and one');
  }
  return value;
}

function vectorsValue(value, expectedCount) {
  const vectors = objectValue(value, 'embedding response').vectors;
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) throw new Error('invalid vector count');
  let dimension;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('vectors must be non-empty');
    if (dimension === undefined) dimension = vector.length;
    if (vector.length !== dimension || vector.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
      throw new Error('vectors must have consistent finite numeric values');
    }
  }
  return vectors;
}

export function createNeedleClient({ url = 'http://127.0.0.1:8792', timeoutMs = 3000, fetchImpl = fetch } = {}) {
  const baseUrl = new URL(url);
  if (baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost' && baseUrl.hostname !== '::1') {
    throw new Error('Needle service URL must use a loopback host');
  }

  async function post(path, body) {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(new URL(path, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Needle service returned HTTP ${response.status}`);
    return objectValue(await response.json(), 'Needle response');
  }

  return {
    async classifyRequest({ query, toolsAvailable }) {
      const value = await post('/v1/classify', { request: query, toolsAvailable });
      if (!COMPLEXITIES.has(value.complexity) || !ACTION_CLASSES.has(value.actionClass)) {
        throw new Error('Needle classification contains an invalid enum');
      }
      return { complexity: value.complexity, actionClass: value.actionClass, confidence: confidenceValue(value.confidence) };
    },
    async embed(inputs) {
      return vectorsValue(await post('/v1/embed', { inputs }), inputs.length);
    },
    async extractToolArguments({ query, tool }) {
      const value = await post('/v1/extract', {
        request: query,
        tool: { serverId: 'trueforge', toolName: tool.name },
        schema: tool.inputSchema,
      });
      const argumentsValue = objectValue(value.arguments, 'arguments');
      const confidence = confidenceValue(value.confidence, true);
      if (confidence === null) throw new Error('Needle extraction did not provide native confidence');
      return { arguments: argumentsValue, confidence };
    },
  };
}
