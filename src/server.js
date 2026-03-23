/**
 * json-schema-api — Express Server + MCP endpoint
 * REST API at various routes, MCP at POST /mcp
 */

const express = require('express');
const cors = require('cors');
const {
  generateSchema,
  validateJson,
  diffSchemas,
  schemaToTypescript,
  schemaToMock,
  mergeSchemas,
  schemaToDocs,
  extractFromOpenApi,
} = require('./schema');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    name: 'json-schema-api',
    version: '1.0.0',
    description: 'Developer power tool for JSON Schema: generate, validate, diff, convert, mock, merge, document.',
    endpoints: [
      'POST /generate — Generate schema from JSON sample',
      'POST /validate — Validate JSON against schema',
      'POST /diff — Compare two schemas',
      'POST /to-typescript — Convert schema to TypeScript',
      'POST /to-mock — Generate mock data from schema',
      'POST /merge — Merge multiple schemas',
      'POST /to-docs — Generate Markdown docs from schema',
      'POST /extract-openapi — Extract schemas from OpenAPI spec',
      'POST /mcp — MCP JSON-RPC endpoint',
    ],
  });
});

// ─── REST Endpoints ───────────────────────────────────────────────────────────

app.post('/generate', (req, res) => {
  try {
    const { data, options } = req.body;
    if (data === undefined) return res.status(400).json({ error: 'Missing "data" field' });
    res.json(generateSchema(data, options));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/validate', (req, res) => {
  try {
    const { data, schema } = req.body;
    if (data === undefined) return res.status(400).json({ error: 'Missing "data" field' });
    if (!schema) return res.status(400).json({ error: 'Missing "schema" field' });
    res.json(validateJson(data, schema));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/diff', (req, res) => {
  try {
    const { schemaA, schemaB } = req.body;
    if (!schemaA || !schemaB) return res.status(400).json({ error: 'Missing "schemaA" or "schemaB"' });
    res.json(diffSchemas(schemaA, schemaB));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/to-typescript', (req, res) => {
  try {
    const { schema, options } = req.body;
    if (!schema) return res.status(400).json({ error: 'Missing "schema" field' });
    res.json({ typescript: schemaToTypescript(schema, options) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/to-mock', (req, res) => {
  try {
    const { schema, options } = req.body;
    if (!schema) return res.status(400).json({ error: 'Missing "schema" field' });
    res.json({ mock: schemaToMock(schema, options) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/merge', (req, res) => {
  try {
    const { schemas } = req.body;
    if (!schemas || !Array.isArray(schemas)) return res.status(400).json({ error: 'Missing "schemas" array' });
    res.json(mergeSchemas(schemas));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/to-docs', (req, res) => {
  try {
    const { schema, options } = req.body;
    if (!schema) return res.status(400).json({ error: 'Missing "schema" field' });
    res.json({ markdown: schemaToDocs(schema, options) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/extract-openapi', (req, res) => {
  try {
    const { spec } = req.body;
    if (!spec) return res.status(400).json({ error: 'Missing "spec" field' });
    res.json(extractFromOpenApi(spec));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── MCP Endpoint (JSON-RPC 2.0) ─────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: 'generate_schema',
    description: 'Infer a JSON Schema (draft-07) from a sample JSON value. Detects dates, emails, URIs, UUIDs, IPs, and auto-detects enums.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'The JSON sample to infer a schema from (any valid JSON)' },
        title: { type: 'string', description: 'Optional schema title' },
        description: { type: 'string', description: 'Optional schema description' },
      },
      required: ['data'],
    },
  },
  {
    name: 'validate_json',
    description: 'Validate JSON data against a JSON Schema (draft-07). Returns validation result with detailed error paths.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'The JSON data to validate' },
        schema: { type: 'object', description: 'The JSON Schema to validate against' },
      },
      required: ['data', 'schema'],
    },
  },
  {
    name: 'diff_schemas',
    description: 'Compare two JSON Schemas and return a detailed diff: added, removed, and modified fields.',
    inputSchema: {
      type: 'object',
      properties: {
        schemaA: { type: 'object', description: 'First schema' },
        schemaB: { type: 'object', description: 'Second schema' },
      },
      required: ['schemaA', 'schemaB'],
    },
  },
  {
    name: 'schema_to_typescript',
    description: 'Convert a JSON Schema to TypeScript interface definitions.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'object', description: 'The JSON Schema to convert' },
        rootName: { type: 'string', description: 'Name for the root type (default: Root)' },
        exportTypes: { type: 'boolean', description: 'Whether to add export keyword (default: true)' },
      },
      required: ['schema'],
    },
  },
  {
    name: 'schema_to_mock',
    description: 'Generate realistic mock/fake data from a JSON Schema. Produces format-aware values (emails, dates, UUIDs, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'object', description: 'The JSON Schema to generate mock data from' },
        count: { type: 'integer', description: 'Number of mock items to generate (default: 1)' },
        seed: { type: 'integer', description: 'Random seed for reproducible output' },
      },
      required: ['schema'],
    },
  },
  {
    name: 'merge_schemas',
    description: 'Merge multiple JSON Schemas into one combined schema. Resolves allOf, merges properties, unions required fields.',
    inputSchema: {
      type: 'object',
      properties: {
        schemas: { type: 'array', items: { type: 'object' }, description: 'Array of schemas to merge' },
      },
      required: ['schemas'],
    },
  },
  {
    name: 'schema_to_docs',
    description: 'Generate human-readable Markdown documentation from a JSON Schema.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'object', description: 'The JSON Schema to document' },
        title: { type: 'string', description: 'Document title override' },
      },
      required: ['schema'],
    },
  },
];

function handleMcpTool(toolName, args) {
  switch (toolName) {
    case 'generate_schema':
      return generateSchema(args.data, { title: args.title, description: args.description });
    case 'validate_json':
      return validateJson(args.data, args.schema);
    case 'diff_schemas':
      return diffSchemas(args.schemaA, args.schemaB);
    case 'schema_to_typescript':
      return { typescript: schemaToTypescript(args.schema, { rootName: args.rootName, exportTypes: args.exportTypes }) };
    case 'schema_to_mock':
      return { mock: schemaToMock(args.schema, { count: args.count, seed: args.seed }) };
    case 'merge_schemas':
      return mergeSchemas(args.schemas);
    case 'schema_to_docs':
      return { markdown: schemaToDocs(args.schema, { title: args.title }) };
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

app.post('/mcp', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request: expected jsonrpc 2.0' } });
  }

  try {
    switch (method) {
      case 'initialize':
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'json-schema-api', version: '1.0.0' },
          },
        });

      case 'tools/list':
        return res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: MCP_TOOLS },
        });

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        if (!name) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } });
        }
        const result = handleMcpTool(name, args || {});
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        });
      }

      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (e) {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
        isError: true,
      },
    });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`json-schema-api running on http://localhost:${PORT}`);
  });
}

module.exports = app;
