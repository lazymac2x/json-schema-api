/**
 * json-schema-api — Comprehensive Test Suite (zero dependencies)
 */

const {
  generateSchema,
  validateJson,
  diffSchemas,
  schemaToTypescript,
  schemaToMock,
  mergeSchemas,
  schemaToDocs,
  extractFromOpenApi,
} = require('../src/schema');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.log(`  \u2717 FAIL: ${name}`);
  }
}

function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.log(`  \u2717 FAIL: ${name}`);
    console.log(`    Expected: ${b}`);
    console.log(`    Actual:   ${a}`);
  }
}

// ─── 1. Schema Generation ─────────────────────────────────────────────────────
console.log('\n=== Schema Generation ===');

(() => {
  const schema = generateSchema({
    name: 'Alice',
    age: 30,
    email: 'alice@example.com',
    active: true,
    scores: [95, 88, 72],
    address: { city: 'NYC', zip: '10001' },
  });
  assert(schema.$schema === 'http://json-schema.org/draft-07/schema#', 'Includes $schema draft-07');
  assert(schema.type === 'object', 'Root type is object');
  assert(schema.properties.name.type === 'string', 'Infers string type');
  assert(schema.properties.age.type === 'integer', 'Infers integer type');
  assert(schema.properties.email.format === 'email', 'Detects email format');
  assert(schema.properties.active.type === 'boolean', 'Infers boolean type');
  assert(schema.properties.scores.type === 'array', 'Infers array type');
  assert(schema.properties.scores.items.type === 'integer', 'Infers array item type');
  assert(schema.properties.address.type === 'object', 'Infers nested object');
  assert(schema.required.includes('name'), 'Required fields detected');
})();

(() => {
  const schema = generateSchema({
    url: 'https://example.com/path',
    created: '2024-01-15T10:30:00Z',
    id: '550e8400-e29b-41d4-a716-446655440000',
    ip: '192.168.1.1',
  });
  assert(schema.properties.url.format === 'uri', 'Detects URI format');
  assert(schema.properties.created.format === 'date-time', 'Detects date-time format');
  assert(schema.properties.id.format === 'uuid', 'Detects UUID format');
  assert(schema.properties.ip.format === 'ipv4', 'Detects IPv4 format');
})();

(() => {
  const schema = generateSchema(null);
  assert(schema.type === 'null', 'Handles null');
})();

(() => {
  const schema = generateSchema([1, 2, 3]);
  assert(schema.type === 'array', 'Handles root array');
  assert(schema.items.type === 'integer', 'Array item type inferred');
})();

(() => {
  const schema = generateSchema({ title: 'Test' }, { title: 'MySchema', description: 'A test schema' });
  assert(schema.title === 'MySchema', 'Custom title applied');
  assert(schema.description === 'A test schema', 'Custom description applied');
})();

// ─── 2. Schema Validation ─────────────────────────────────────────────────────
console.log('\n=== Schema Validation ===');

(() => {
  const schema = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name'] };
  const result = validateJson({ name: 'Alice', age: 30 }, schema);
  assert(result.valid === true, 'Valid object passes');
})();

(() => {
  const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
  const result = validateJson({}, schema);
  assert(result.valid === false, 'Missing required field fails');
  assert(result.errors[0].keyword === 'required', 'Error keyword is required');
})();

(() => {
  const schema = { type: 'string', minLength: 3, maxLength: 10 };
  assert(validateJson('hello', schema).valid, 'String length valid');
  assert(!validateJson('hi', schema).valid, 'String too short');
  assert(!validateJson('hello world!', schema).valid, 'String too long');
})();

(() => {
  const schema = { type: 'number', minimum: 0, maximum: 100 };
  assert(validateJson(50, schema).valid, 'Number in range');
  assert(!validateJson(-1, schema).valid, 'Number below minimum');
  assert(!validateJson(101, schema).valid, 'Number above maximum');
})();

(() => {
  const schema = { type: 'string', pattern: '^[A-Z]{3}$' };
  assert(validateJson('ABC', schema).valid, 'Pattern match');
  assert(!validateJson('abc', schema).valid, 'Pattern mismatch');
})();

(() => {
  const schema = { type: 'string', format: 'email' };
  assert(validateJson('a@b.com', schema).valid, 'Valid email format');
  assert(!validateJson('not-email', schema).valid, 'Invalid email format');
})();

(() => {
  const schema = { enum: ['red', 'green', 'blue'] };
  assert(validateJson('red', schema).valid, 'Enum valid value');
  assert(!validateJson('yellow', schema).valid, 'Enum invalid value');
})();

(() => {
  const schema = { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 3, uniqueItems: true };
  assert(validateJson([1, 2, 3], schema).valid, 'Array valid');
  assert(!validateJson([], schema).valid, 'Array too few items');
  assert(!validateJson([1, 1, 2], schema).valid, 'Array non-unique');
})();

(() => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' } },
    additionalProperties: false,
  };
  assert(!validateJson({ a: 'ok', b: 'extra' }, schema).valid, 'Additional properties rejected');
})();

(() => {
  const schema = {
    anyOf: [{ type: 'string' }, { type: 'number' }],
  };
  assert(validateJson('hello', schema).valid, 'anyOf string match');
  assert(validateJson(42, schema).valid, 'anyOf number match');
  assert(!validateJson(true, schema).valid, 'anyOf no match');
})();

(() => {
  const schema = {
    oneOf: [{ type: 'integer', minimum: 0 }, { type: 'integer', maximum: 5 }],
  };
  assert(validateJson(10, schema).valid, 'oneOf exactly one match');
  // 3 matches both: min>=0 and max<=5
  assert(!validateJson(3, schema).valid, 'oneOf two matches fails');
})();

(() => {
  const schema = { not: { type: 'string' } };
  assert(validateJson(42, schema).valid, 'not: non-string passes');
  assert(!validateJson('hello', schema).valid, 'not: string fails');
})();

(() => {
  const schema = {
    type: 'object',
    properties: { type: { type: 'string' }, value: {} },
    if: { properties: { type: { const: 'number' } } },
    then: { properties: { value: { type: 'number' } } },
    else: { properties: { value: { type: 'string' } } },
  };
  assert(validateJson({ type: 'number', value: 42 }, schema).valid, 'if/then valid');
  assert(validateJson({ type: 'text', value: 'hi' }, schema).valid, 'if/else valid');
})();

// ─── 3. Schema Diff ──────────────────────────────────────────────────────────
console.log('\n=== Schema Diff ===');

(() => {
  const a = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } };
  const b = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } };
  const diff = diffSchemas(a, b);
  assert(diff.identical === true, 'Identical schemas detected');
})();

(() => {
  const a = { type: 'object', properties: { name: { type: 'string' } } };
  const b = { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } } };
  const diff = diffSchemas(a, b);
  assert(diff.added.length === 1, 'Added field detected');
  assert(diff.added[0].path.includes('email'), 'Added field is email');
})();

(() => {
  const a = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } };
  const b = { type: 'object', properties: { name: { type: 'string' } } };
  const diff = diffSchemas(a, b);
  assert(diff.removed.length > 0, 'Removed field detected');
})();

(() => {
  const a = { type: 'object', properties: { age: { type: 'integer' } } };
  const b = { type: 'object', properties: { age: { type: 'string' } } };
  const diff = diffSchemas(a, b);
  assert(diff.modified.length === 1, 'Modified field detected');
})();

// ─── 4. Schema to TypeScript ─────────────────────────────────────────────────
console.log('\n=== Schema to TypeScript ===');

(() => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      active: { type: 'boolean' },
    },
    required: ['name', 'age'],
  };
  const ts = schemaToTypescript(schema, { rootName: 'User' });
  assert(ts.includes('interface User'), 'Interface name correct');
  assert(ts.includes('name: string'), 'Required string field');
  assert(ts.includes('age: number'), 'Integer mapped to number');
  assert(ts.includes('tags?: string[]'), 'Optional array field');
  assert(ts.includes('active?: boolean'), 'Optional boolean field');
  assert(ts.includes('export'), 'Export keyword present');
})();

(() => {
  const schema = {
    type: 'object',
    properties: {
      status: { enum: ['active', 'inactive', 'pending'] },
    },
  };
  const ts = schemaToTypescript(schema);
  assert(ts.includes("'active'") && ts.includes("'inactive'"), 'Enum to union type');
})();

(() => {
  const schema = {
    type: 'object',
    properties: {
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
        },
        required: ['street'],
      },
    },
  };
  const ts = schemaToTypescript(schema);
  assert(ts.includes('RootAddress'), 'Nested interface generated');
  assert(ts.includes('street: string'), 'Nested required field');
})();

// ─── 5. Schema to Mock Data ─────────────────────────────────────────────────
console.log('\n=== Schema to Mock Data ===');

(() => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 18, maximum: 65 },
      email: { type: 'string', format: 'email' },
      id: { type: 'string', format: 'uuid' },
      active: { type: 'boolean' },
    },
    required: ['name', 'age', 'email'],
  };
  const mock = schemaToMock(schema, { seed: 42 });
  assert(typeof mock.name === 'string' && mock.name.length > 0, 'Mock string generated');
  assert(typeof mock.age === 'number' && mock.age >= 18 && mock.age <= 65, 'Mock integer in range');
  assert(typeof mock.email === 'string' && mock.email.includes('@'), 'Mock email format');
  assert(!mock.id || (typeof mock.id === 'string' && mock.id.includes('-')), 'Mock UUID format');
})();

(() => {
  const schema = { type: 'array', items: { type: 'integer', minimum: 0, maximum: 100 }, minItems: 3, maxItems: 5 };
  const mock = schemaToMock(schema, { seed: 42 });
  assert(Array.isArray(mock) && mock.length >= 3 && mock.length <= 5, 'Mock array correct length');
  assert(mock.every(v => typeof v === 'number' && v >= 0 && v <= 100), 'Mock array values in range');
})();

(() => {
  // Reproducibility
  const schema = { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] };
  const a = schemaToMock(schema, { seed: 123 });
  const b = schemaToMock(schema, { seed: 123 });
  assertEq(a, b, 'Mock is reproducible with same seed');
})();

(() => {
  const schema = { type: 'object', properties: { n: { type: 'string' } }, required: ['n'] };
  const mocks = schemaToMock(schema, { seed: 42, count: 5 });
  assert(Array.isArray(mocks) && mocks.length === 5, 'Multiple mocks generated');
})();

// ─── 6. Schema Merge ────────────────────────────────────────────────────────
console.log('\n=== Schema Merge ===');

(() => {
  const a = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
  const b = { type: 'object', properties: { age: { type: 'integer' } }, required: ['age'] };
  const merged = mergeSchemas([a, b]);
  assert(merged.properties.name && merged.properties.age, 'Both properties present');
  assert(merged.required.includes('name') && merged.required.includes('age'), 'Both required');
})();

(() => {
  const a = { type: 'string', minLength: 5, maxLength: 10 };
  const b = { type: 'string', minLength: 1, maxLength: 20 };
  const merged = mergeSchemas([a, b]);
  assert(merged.minLength === 1, 'Min constraint relaxed');
  assert(merged.maxLength === 20, 'Max constraint expanded');
})();

(() => {
  const a = { type: 'string', enum: ['a', 'b'] };
  const b = { type: 'string', enum: ['b', 'c'] };
  const merged = mergeSchemas([a, b]);
  assert(merged.enum.length === 3, 'Enums merged (union)');
})();

// ─── 7. Schema to Docs ─────────────────────────────────────────────────────
console.log('\n=== Schema to Docs ===');

(() => {
  const schema = {
    title: 'User',
    description: 'A user object',
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full name' },
      age: { type: 'integer', minimum: 0 },
      email: { type: 'string', format: 'email' },
    },
    required: ['name', 'email'],
  };
  const md = schemaToDocs(schema);
  assert(md.includes('# User'), 'Title in docs');
  assert(md.includes('A user object'), 'Description in docs');
  assert(md.includes('| `name`'), 'Property table has name');
  assert(md.includes('| Yes |'), 'Required column present');
  assert(md.includes('Full name'), 'Property description in docs');
})();

// ─── 8. OpenAPI Extraction ──────────────────────────────────────────────────
console.log('\n=== OpenAPI Extraction ===');

(() => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          summary: 'Get all users',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createUser',
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
          },
          required: ['id', 'name'],
        },
      },
    },
  };

  const result = extractFromOpenApi(spec);
  assert(result.schemas.User !== undefined, 'Component schema extracted');
  assert(result.schemas.User.properties.id.type === 'integer', 'Schema properties resolved');
  assert(result.endpoints.length === 2, 'Both endpoints extracted');
  assert(result.endpoints[0].method === 'GET', 'GET endpoint');
  assert(result.endpoints[1].method === 'POST', 'POST endpoint');
  assert(result.endpoints[1].request !== null, 'Request body extracted');
  assert(result.endpoints[0].responses['200'] !== undefined, 'Response schema extracted');
  assert(result.endpoints[0].responses['200'].schema.type === 'array', 'Response is array');
  assert(result.endpoints[0].responses['200'].schema.items.properties.id.type === 'integer', '$ref resolved in response');
})();

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log('All tests passed!');
