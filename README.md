<p align="center"><img src="logo.png" width="120" alt="logo"></p>

[![lazymac API Store](https://img.shields.io/badge/lazymac-API%20Store-blue?style=flat-square)](https://lazymac2x.github.io/lazymac-api-store/) [![Gumroad](https://img.shields.io/badge/Buy%20on-Gumroad-ff69b4?style=flat-square)](https://coindany.gumroad.com/) [![MCPize](https://img.shields.io/badge/MCP-MCPize-green?style=flat-square)](https://mcpize.com/mcp/json-schema-api)

# json-schema-api

Developer power tool for JSON Schema — generate schemas from samples, validate data, diff schemas, convert to TypeScript, generate mock data, merge schemas, and produce Markdown docs. Zero external dependencies. REST + MCP server.

## Quick Start

```bash
npm install && npm start  # http://localhost:3000
```

## Endpoints

### Generate Schema from JSON
```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"data": {"name": "John", "age": 30, "email": "john@example.com"}}'
# → JSON Schema (draft-07) with auto-detected formats (email, uri, date, uuid, ip)
```

### Validate JSON against Schema
```bash
curl -X POST http://localhost:3000/validate \
  -H "Content-Type: application/json" \
  -d '{"data": {"name": "John"}, "schema": {"type": "object", "required": ["name", "age"]}}'
# → {valid, errors}
```

### Diff Two Schemas
```bash
curl -X POST http://localhost:3000/diff \
  -H "Content-Type: application/json" \
  -d '{"schemaA": {...}, "schemaB": {...}}'
# → {added, removed, modified}
```

### Convert to TypeScript
```bash
curl -X POST http://localhost:3000/to-typescript \
  -H "Content-Type: application/json" \
  -d '{"schema": {"type": "object", "properties": {"name": {"type": "string"}}}}'
# → {typescript: "export interface Root { name?: string; }"}
```

### Generate Mock Data
```bash
curl -X POST http://localhost:3000/to-mock \
  -H "Content-Type: application/json" \
  -d '{"schema": {"type": "object", "properties": {"email": {"type": "string", "format": "email"}}}}'
# → {mock: {email: "user42@example.com"}}
```

### Merge Schemas
```bash
curl -X POST http://localhost:3000/merge \
  -H "Content-Type: application/json" \
  -d '{"schemas": [{"type": "object", "properties": {"a": {"type": "string"}}}, {"type": "object", "properties": {"b": {"type": "number"}}}]}'
```

### Generate Markdown Docs
```bash
curl -X POST http://localhost:3000/to-docs \
  -H "Content-Type: application/json" \
  -d '{"schema": {"type": "object", "properties": {"name": {"type": "string", "description": "User name"}}}}'
```

### Extract from OpenAPI Spec
```bash
curl -X POST http://localhost:3000/extract-openapi \
  -H "Content-Type: application/json" \
  -d '{"spec": {...}}'
```

### MCP (JSON-RPC 2.0)
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

**MCP Tools:** `generate_schema`, `validate_json`, `diff_schemas`, `schema_to_typescript`, `schema_to_mock`, `merge_schemas`, `schema_to_docs`

## License
MIT
