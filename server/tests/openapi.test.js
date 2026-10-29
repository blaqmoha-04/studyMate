// Keeps docs/openapi.yaml honest: every real route is documented and every documented route exists.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { makeApp } from './helpers.js';
import { apiRouter } from '../src/routes/index.js';

const specPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/openapi.yaml');

function collect(router, prefix = '') {
  const out = [];
  for (const layer of router.stack) {
    if (layer.route) for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${layer.route.path.replace(/:(\w+)/g, '{$1}')}`);
    else if (layer.name === 'router') out.push(...collect(layer.handle, prefix + (layer.regexp.source.includes('auth') ? '/auth' : '')));
  }
  return out;
}

describe('OpenAPI specification', () => {
  let built; before(() => { built = makeApp(); }); after(() => built.close());
  const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
  it('is a valid-looking OpenAPI 3 document', () => { assert.match(spec.openapi, /^3\./); assert.ok(spec.info.title); assert.ok(Object.keys(spec.paths).length > 40); });
  it('documents exactly the routes the server implements', () => {
    const real = new Set(collect(apiRouter(built.ctx)));
    const documented = new Set(Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).map((m) => `${m.toUpperCase()} ${p}`)));
    assert.ok(real.size > 40, `route introspection found only ${real.size}`);
    assert.deepEqual([...real].filter((r) => !documented.has(r)).sort(), [], 'implemented but undocumented');
    assert.deepEqual([...documented].filter((r) => !real.has(r)).sort(), [], 'documented but not implemented');
  });
  it('every $ref resolves', () => {
    const text = fs.readFileSync(specPath, 'utf8');
    for (const [, ref] of text.matchAll(/\$ref: '#\/([^']+)'/g)) { let node = spec; for (const part of ref.split('/')) node = node?.[part]; assert.ok(node, `broken $ref #/${ref}`); }
  });
});
