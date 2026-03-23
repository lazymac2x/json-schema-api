/**
 * json-schema-api — Core Schema Operations
 * Zero external dependencies. Draft-07 compatible.
 */

// ─── Pattern Detection ────────────────────────────────────────────────────────

const PATTERNS = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  uri: /^https?:\/\/[^\s/$.?#].[^\s]*$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?$/,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
  ipv6: /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  hostname: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
};

function detectFormat(value) {
  if (typeof value !== 'string') return null;
  for (const [format, regex] of Object.entries(PATTERNS)) {
    if (regex.test(value)) return format;
  }
  return null;
}

// ─── 1. Schema Generation ─────────────────────────────────────────────────────

function generateSchema(data, options = {}) {
  const { title, description, inferEnums = true, enumThreshold = 5 } = options;

  function infer(value, samples = null) {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) return inferArray(value);
    switch (typeof value) {
      case 'boolean': return { type: 'boolean' };
      case 'number':
        return Number.isInteger(value)
          ? { type: 'integer' }
          : { type: 'number' };
      case 'string': {
        const schema = { type: 'string' };
        const fmt = detectFormat(value);
        if (fmt) schema.format = fmt;
        if (value.length > 0 && samples && inferEnums) {
          const unique = [...new Set(samples)];
          if (unique.length <= enumThreshold && unique.length < samples.length * 0.5) {
            schema.enum = unique.sort();
          }
        }
        return schema;
      }
      case 'object': return inferObject(value);
      default: return {};
    }
  }

  function inferArray(arr) {
    if (arr.length === 0) return { type: 'array', items: {} };
    // Collect all schemas from items
    const schemas = arr.map(item => infer(item));
    const merged = mergeInferredSchemas(schemas);
    // If array of objects, collect field-level samples for enum detection
    if (arr.length > 0 && typeof arr[0] === 'object' && !Array.isArray(arr[0]) && arr[0] !== null) {
      const fieldSamples = {};
      for (const item of arr) {
        if (item && typeof item === 'object') {
          for (const [k, v] of Object.entries(item)) {
            if (typeof v === 'string') {
              if (!fieldSamples[k]) fieldSamples[k] = [];
              fieldSamples[k].push(v);
            }
          }
        }
      }
      // Re-infer object with enum samples
      if (merged.type === 'object' && merged.properties) {
        for (const [k, v] of Object.entries(merged.properties)) {
          if (v.type === 'string' && fieldSamples[k] && inferEnums) {
            const unique = [...new Set(fieldSamples[k])];
            if (unique.length <= enumThreshold && unique.length < fieldSamples[k].length * 0.5) {
              merged.properties[k].enum = unique.sort();
            }
          }
        }
      }
    }
    return { type: 'array', items: merged };
  }

  function inferObject(obj) {
    if (obj === null) return { type: 'null' };
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(obj)) {
      properties[key] = infer(value);
      if (value !== null && value !== undefined) {
        required.push(key);
      }
    }
    const schema = { type: 'object', properties };
    if (required.length > 0) schema.required = required.sort();
    return schema;
  }

  function mergeInferredSchemas(schemas) {
    if (schemas.length === 0) return {};
    if (schemas.length === 1) return schemas[0];
    const types = [...new Set(schemas.map(s => s.type))];
    if (types.length === 1 && types[0] === 'object') {
      // Merge object schemas
      const allKeys = new Set();
      for (const s of schemas) {
        if (s.properties) Object.keys(s.properties).forEach(k => allKeys.add(k));
      }
      const properties = {};
      const requiredSets = schemas.map(s => new Set(s.required || []));
      const required = [];
      for (const key of allKeys) {
        const fieldSchemas = schemas
          .filter(s => s.properties && s.properties[key])
          .map(s => s.properties[key]);
        properties[key] = fieldSchemas.length > 0
          ? mergeInferredSchemas(fieldSchemas)
          : {};
        // Only required if present in ALL schemas
        if (requiredSets.every(set => set.has(key))) {
          required.push(key);
        }
      }
      const result = { type: 'object', properties };
      if (required.length > 0) result.required = required.sort();
      return result;
    }
    if (types.length === 1) return schemas[0];
    // Mixed types: use oneOf if very different, or widen
    if (types.includes('integer') && types.includes('number') && types.length === 2) {
      return { type: 'number' };
    }
    return { oneOf: schemas.filter((s, i, arr) => arr.findIndex(x => JSON.stringify(x) === JSON.stringify(s)) === i) };
  }

  const schema = infer(data);
  const root = { $schema: 'http://json-schema.org/draft-07/schema#', ...schema };
  if (title) root.title = title;
  if (description) root.description = description;
  return root;
}

// ─── 2. Schema Validation ─────────────────────────────────────────────────────

function validateJson(data, schema) {
  const errors = [];

  function validate(value, sch, path) {
    if (!sch || typeof sch !== 'object') return;

    // $ref — not resolved here, skip
    if (sch.$ref) return;

    // enum
    if (sch.enum) {
      if (!sch.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) {
        errors.push({ path, message: `Value must be one of: ${JSON.stringify(sch.enum)}`, keyword: 'enum' });
      }
    }

    // const
    if ('const' in sch) {
      if (JSON.stringify(value) !== JSON.stringify(sch.const)) {
        errors.push({ path, message: `Value must be ${JSON.stringify(sch.const)}`, keyword: 'const' });
      }
    }

    // type
    if (sch.type) {
      const types = Array.isArray(sch.type) ? sch.type : [sch.type];
      const actualType = getType(value);
      const typeValid = types.some(t => {
        if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
        if (t === 'number') return typeof value === 'number';
        return t === actualType;
      });
      if (!typeValid) {
        errors.push({ path, message: `Expected type ${sch.type}, got ${actualType}`, keyword: 'type' });
        return; // Don't validate further if type mismatch
      }
    }

    // String validations
    if (typeof value === 'string') {
      if (sch.minLength !== undefined && value.length < sch.minLength) {
        errors.push({ path, message: `String must be at least ${sch.minLength} characters`, keyword: 'minLength' });
      }
      if (sch.maxLength !== undefined && value.length > sch.maxLength) {
        errors.push({ path, message: `String must be at most ${sch.maxLength} characters`, keyword: 'maxLength' });
      }
      if (sch.pattern) {
        const regex = new RegExp(sch.pattern);
        if (!regex.test(value)) {
          errors.push({ path, message: `String must match pattern: ${sch.pattern}`, keyword: 'pattern' });
        }
      }
      if (sch.format) {
        const formatRegex = PATTERNS[sch.format];
        if (formatRegex && !formatRegex.test(value)) {
          errors.push({ path, message: `String must be a valid ${sch.format}`, keyword: 'format' });
        }
      }
    }

    // Number validations
    if (typeof value === 'number') {
      if (sch.minimum !== undefined && value < sch.minimum) {
        errors.push({ path, message: `Must be >= ${sch.minimum}`, keyword: 'minimum' });
      }
      if (sch.maximum !== undefined && value > sch.maximum) {
        errors.push({ path, message: `Must be <= ${sch.maximum}`, keyword: 'maximum' });
      }
      if (sch.exclusiveMinimum !== undefined && value <= sch.exclusiveMinimum) {
        errors.push({ path, message: `Must be > ${sch.exclusiveMinimum}`, keyword: 'exclusiveMinimum' });
      }
      if (sch.exclusiveMaximum !== undefined && value >= sch.exclusiveMaximum) {
        errors.push({ path, message: `Must be < ${sch.exclusiveMaximum}`, keyword: 'exclusiveMaximum' });
      }
      if (sch.multipleOf !== undefined && (value / sch.multipleOf) % 1 !== 0) {
        errors.push({ path, message: `Must be a multiple of ${sch.multipleOf}`, keyword: 'multipleOf' });
      }
    }

    // Array validations
    if (Array.isArray(value)) {
      if (sch.minItems !== undefined && value.length < sch.minItems) {
        errors.push({ path, message: `Array must have at least ${sch.minItems} items`, keyword: 'minItems' });
      }
      if (sch.maxItems !== undefined && value.length > sch.maxItems) {
        errors.push({ path, message: `Array must have at most ${sch.maxItems} items`, keyword: 'maxItems' });
      }
      if (sch.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) {
        errors.push({ path, message: 'Array items must be unique', keyword: 'uniqueItems' });
      }
      if (sch.items) {
        value.forEach((item, i) => validate(item, sch.items, `${path}[${i}]`));
      }
      if (sch.contains) {
        const hasMatch = value.some((item) => {
          const subErrors = [];
          const origLen = errors.length;
          validate(item, sch.contains, `${path}[contains]`);
          const newErrors = errors.splice(origLen);
          return newErrors.length === 0;
        });
        if (!hasMatch) {
          errors.push({ path, message: 'Array must contain at least one matching item', keyword: 'contains' });
        }
      }
    }

    // Object validations
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (sch.minProperties !== undefined && keys.length < sch.minProperties) {
        errors.push({ path, message: `Object must have at least ${sch.minProperties} properties`, keyword: 'minProperties' });
      }
      if (sch.maxProperties !== undefined && keys.length > sch.maxProperties) {
        errors.push({ path, message: `Object must have at most ${sch.maxProperties} properties`, keyword: 'maxProperties' });
      }
      if (sch.required) {
        for (const req of sch.required) {
          if (!(req in value)) {
            errors.push({ path: `${path}.${req}`, message: `Required property missing`, keyword: 'required' });
          }
        }
      }
      if (sch.properties) {
        for (const [key, propSchema] of Object.entries(sch.properties)) {
          if (key in value) {
            validate(value[key], propSchema, `${path}.${key}`);
          }
        }
      }
      if (sch.additionalProperties === false) {
        const allowed = new Set(Object.keys(sch.properties || {}));
        const patternKeys = (sch.patternProperties) ? Object.keys(sch.patternProperties) : [];
        for (const key of keys) {
          if (!allowed.has(key) && !patternKeys.some(p => new RegExp(p).test(key))) {
            errors.push({ path: `${path}.${key}`, message: `Additional property not allowed`, keyword: 'additionalProperties' });
          }
        }
      } else if (sch.additionalProperties && typeof sch.additionalProperties === 'object') {
        const allowed = new Set(Object.keys(sch.properties || {}));
        for (const key of keys) {
          if (!allowed.has(key)) {
            validate(value[key], sch.additionalProperties, `${path}.${key}`);
          }
        }
      }
      if (sch.patternProperties) {
        for (const [pattern, propSchema] of Object.entries(sch.patternProperties)) {
          const regex = new RegExp(pattern);
          for (const key of keys) {
            if (regex.test(key)) {
              validate(value[key], propSchema, `${path}.${key}`);
            }
          }
        }
      }
      // dependencies
      if (sch.dependencies) {
        for (const [key, dep] of Object.entries(sch.dependencies)) {
          if (key in value) {
            if (Array.isArray(dep)) {
              for (const d of dep) {
                if (!(d in value)) {
                  errors.push({ path, message: `Property "${key}" requires "${d}"`, keyword: 'dependencies' });
                }
              }
            } else {
              validate(value, dep, path);
            }
          }
        }
      }
    }

    // Combinators
    if (sch.allOf) {
      for (const sub of sch.allOf) validate(value, sub, path);
    }
    if (sch.anyOf) {
      const origLen = errors.length;
      let anyValid = false;
      for (const sub of sch.anyOf) {
        const before = errors.length;
        validate(value, sub, path);
        if (errors.length === before) { anyValid = true; break; }
        errors.splice(before);
      }
      if (!anyValid) {
        errors.push({ path, message: 'Must match at least one schema in anyOf', keyword: 'anyOf' });
      }
    }
    if (sch.oneOf) {
      let matchCount = 0;
      for (const sub of sch.oneOf) {
        const before = errors.length;
        validate(value, sub, path);
        if (errors.length === before) matchCount++;
        else errors.splice(before);
      }
      if (matchCount !== 1) {
        errors.push({ path, message: `Must match exactly one schema in oneOf (matched ${matchCount})`, keyword: 'oneOf' });
      }
    }
    if (sch.not) {
      const before = errors.length;
      validate(value, sch.not, path);
      if (errors.length === before) {
        errors.push({ path, message: 'Must NOT match the schema in "not"', keyword: 'not' });
      } else {
        errors.splice(before);
      }
    }

    // if/then/else
    if (sch.if) {
      const before = errors.length;
      validate(value, sch.if, path);
      const ifValid = errors.length === before;
      if (!ifValid) errors.splice(before);
      if (ifValid && sch.then) validate(value, sch.then, path);
      if (!ifValid && sch.else) validate(value, sch.else, path);
    }
  }

  function getType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  validate(data, schema, '$');
  return { valid: errors.length === 0, errors };
}

// ─── 3. Schema Diff ───────────────────────────────────────────────────────────

function diffSchemas(schemaA, schemaB) {
  const changes = [];

  function diff(a, b, path) {
    if (a === undefined && b !== undefined) {
      changes.push({ path, type: 'added', value: b });
      return;
    }
    if (a !== undefined && b === undefined) {
      changes.push({ path, type: 'removed', value: a });
      return;
    }
    if (typeof a !== typeof b) {
      changes.push({ path, type: 'modified', from: a, to: b });
      return;
    }
    if (typeof a !== 'object' || a === null || b === null) {
      if (a !== b) {
        changes.push({ path, type: 'modified', from: a, to: b });
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changes.push({ path, type: 'modified', from: a, to: b });
      }
      return;
    }
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
      diff(a[key], b[key], `${path}.${key}`);
    }
  }

  diff(schemaA, schemaB, '$');

  return {
    identical: changes.length === 0,
    totalChanges: changes.length,
    added: changes.filter(c => c.type === 'added'),
    removed: changes.filter(c => c.type === 'removed'),
    modified: changes.filter(c => c.type === 'modified'),
    changes,
  };
}

// ─── 4. Schema to TypeScript ──────────────────────────────────────────────────

function schemaToTypescript(schema, options = {}) {
  const { rootName = 'Root', exportTypes = true } = options;
  const interfaces = [];
  const typeMap = new Map();

  function toTsType(sch, name) {
    if (!sch || typeof sch !== 'object') return 'unknown';

    if (sch.$ref) return sch.$ref.split('/').pop();

    if (sch.enum) {
      return sch.enum.map(v => typeof v === 'string' ? `'${v}'` : String(v)).join(' | ');
    }

    if (sch.oneOf) {
      return sch.oneOf.map((s, i) => toTsType(s, `${name}Option${i + 1}`)).join(' | ');
    }
    if (sch.anyOf) {
      return sch.anyOf.map((s, i) => toTsType(s, `${name}Option${i + 1}`)).join(' | ');
    }
    if (sch.allOf) {
      const types = sch.allOf.map((s, i) => toTsType(s, `${name}Part${i + 1}`));
      return types.join(' & ');
    }

    const types = Array.isArray(sch.type) ? sch.type : [sch.type];

    if (types.includes('null') && types.length === 2) {
      const nonNull = types.find(t => t !== 'null');
      return `${toTsType({ ...sch, type: nonNull }, name)} | null`;
    }

    if (types.includes('object') || sch.properties) {
      return generateInterface(sch, name);
    }

    if (types.includes('array')) {
      if (sch.items) {
        const itemType = toTsType(sch.items, `${name}Item`);
        return `${itemType}[]`;
      }
      return 'unknown[]';
    }

    if (types.includes('string')) {
      if (sch.format === 'date-time' || sch.format === 'date') return 'string';
      return 'string';
    }
    if (types.includes('integer') || types.includes('number')) return 'number';
    if (types.includes('boolean')) return 'boolean';
    if (types.includes('null')) return 'null';

    return 'unknown';
  }

  function generateInterface(sch, name) {
    if (typeMap.has(name)) return name;
    typeMap.set(name, true);

    const required = new Set(sch.required || []);
    const lines = [];
    const prefix = exportTypes ? 'export ' : '';
    lines.push(`${prefix}interface ${name} {`);

    if (sch.properties) {
      for (const [key, propSchema] of Object.entries(sch.properties)) {
        const tsType = toTsType(propSchema, `${name}${capitalize(key)}`);
        const opt = required.has(key) ? '' : '?';
        const desc = propSchema.description ? `  /** ${propSchema.description} */\n` : '';
        const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
        lines.push(`${desc}  ${safeKey}${opt}: ${tsType};`);
      }
    }

    if (sch.additionalProperties === true || (sch.additionalProperties && typeof sch.additionalProperties === 'object')) {
      const valType = typeof sch.additionalProperties === 'object'
        ? toTsType(sch.additionalProperties, `${name}Value`)
        : 'unknown';
      lines.push(`  [key: string]: ${valType};`);
    }

    lines.push('}');
    interfaces.push(lines.join('\n'));
    return name;
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/[^a-zA-Z0-9]/g, '');
  }

  toTsType(schema, rootName);

  if (interfaces.length === 0) {
    // Primitive type at root
    const tsType = toTsType(schema, rootName);
    const prefix = exportTypes ? 'export ' : '';
    return `${prefix}type ${rootName} = ${tsType};\n`;
  }

  return interfaces.join('\n\n') + '\n';
}

// ─── 5. Schema to Mock Data ──────────────────────────────────────────────────

function schemaToMock(schema, options = {}) {
  const { seed = Date.now(), count = 1 } = options;
  let rng = createRng(seed);

  function createRng(s) {
    // Simple mulberry32 PRNG
    let state = s | 0;
    return function () {
      state |= 0; state = state + 0x6D2B79F5 | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function mock(sch) {
    if (!sch || typeof sch !== 'object') return null;

    if (sch.const !== undefined) return sch.const;
    if (sch.enum) return sch.enum[Math.floor(rng() * sch.enum.length)];
    if (sch.default !== undefined) return sch.default;

    if (sch.oneOf) return mock(sch.oneOf[Math.floor(rng() * sch.oneOf.length)]);
    if (sch.anyOf) return mock(sch.anyOf[Math.floor(rng() * sch.anyOf.length)]);
    if (sch.allOf) {
      let result = {};
      for (const sub of sch.allOf) {
        const val = mock(sub);
        if (val && typeof val === 'object') result = { ...result, ...val };
      }
      return result;
    }

    const type = Array.isArray(sch.type) ? sch.type[Math.floor(rng() * sch.type.length)] : sch.type;

    switch (type) {
      case 'string': return mockString(sch);
      case 'number': return mockNumber(sch, false);
      case 'integer': return mockNumber(sch, true);
      case 'boolean': return rng() > 0.5;
      case 'null': return null;
      case 'array': return mockArray(sch);
      case 'object': return mockObject(sch);
      default: return null;
    }
  }

  const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Moore'];
  const domains = ['example.com', 'test.org', 'demo.io', 'sample.net', 'mock.dev'];
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'labore', 'dolore', 'magna', 'aliqua'];

  function mockString(sch) {
    if (sch.format) {
      switch (sch.format) {
        case 'email': {
          const fn = firstNames[Math.floor(rng() * firstNames.length)].toLowerCase();
          const ln = lastNames[Math.floor(rng() * lastNames.length)].toLowerCase();
          const d = domains[Math.floor(rng() * domains.length)];
          return `${fn}.${ln}@${d}`;
        }
        case 'uri':
        case 'url':
          return `https://${domains[Math.floor(rng() * domains.length)]}/path/${Math.floor(rng() * 1000)}`;
        case 'date-time': {
          const d = new Date(1640000000000 + Math.floor(rng() * 63072000000));
          return d.toISOString();
        }
        case 'date': {
          const y = 2020 + Math.floor(rng() * 6);
          const m = String(1 + Math.floor(rng() * 12)).padStart(2, '0');
          const day = String(1 + Math.floor(rng() * 28)).padStart(2, '0');
          return `${y}-${m}-${day}`;
        }
        case 'time': {
          const h = String(Math.floor(rng() * 24)).padStart(2, '0');
          const min = String(Math.floor(rng() * 60)).padStart(2, '0');
          const sec = String(Math.floor(rng() * 60)).padStart(2, '0');
          return `${h}:${min}:${sec}`;
        }
        case 'uuid': return [8, 4, 4, 4, 12].map(n =>
          Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join('')
        ).join('-');
        case 'ipv4': return Array.from({ length: 4 }, () => Math.floor(rng() * 256)).join('.');
        case 'hostname': return `host-${Math.floor(rng() * 1000)}.${domains[Math.floor(rng() * domains.length)]}`;
      }
    }

    const min = sch.minLength || 1;
    const max = sch.maxLength || Math.max(min + 20, 50);
    const len = min + Math.floor(rng() * (max - min));
    let result = '';
    while (result.length < len) {
      result += words[Math.floor(rng() * words.length)] + ' ';
    }
    return result.trim().slice(0, len);
  }

  function mockNumber(sch, integer) {
    const min = sch.minimum ?? sch.exclusiveMinimum ?? 0;
    const max = sch.maximum ?? sch.exclusiveMaximum ?? (min + 100);
    let val = min + rng() * (max - min);
    if (integer) val = Math.floor(val);
    else val = Math.round(val * 100) / 100;
    if (sch.multipleOf) val = Math.round(val / sch.multipleOf) * sch.multipleOf;
    return val;
  }

  function mockArray(sch) {
    const min = sch.minItems || 1;
    const max = sch.maxItems || Math.max(min, 3);
    const len = min + Math.floor(rng() * (max - min + 1));
    return Array.from({ length: len }, () => mock(sch.items || {}));
  }

  function mockObject(sch) {
    const obj = {};
    if (sch.properties) {
      const required = new Set(sch.required || []);
      for (const [key, propSchema] of Object.entries(sch.properties)) {
        // Always include required, 80% chance for optional
        if (required.has(key) || rng() > 0.2) {
          obj[key] = mock(propSchema);
        }
      }
    }
    return obj;
  }

  if (count === 1) return mock(schema);
  return Array.from({ length: count }, () => {
    rng = createRng(seed + Math.floor(rng() * 1000000));
    return mock(schema);
  });
}

// ─── 6. Schema Merge ──────────────────────────────────────────────────────────

function mergeSchemas(schemas) {
  if (!Array.isArray(schemas) || schemas.length === 0) return {};
  if (schemas.length === 1) return { ...schemas[0] };

  function merge(a, b) {
    // Same type objects: deep merge
    if (a.type === 'object' && b.type === 'object') {
      const properties = { ...a.properties };
      if (b.properties) {
        for (const [key, val] of Object.entries(b.properties)) {
          if (properties[key]) {
            properties[key] = merge(properties[key], val);
          } else {
            properties[key] = val;
          }
        }
      }
      const requiredA = new Set(a.required || []);
      const requiredB = new Set(b.required || []);
      // Union of required
      const required = [...new Set([...requiredA, ...requiredB])].sort();

      const result = { type: 'object', properties };
      if (required.length > 0) result.required = required;

      // Merge other keywords
      if (a.additionalProperties !== undefined || b.additionalProperties !== undefined) {
        result.additionalProperties = b.additionalProperties !== undefined
          ? b.additionalProperties : a.additionalProperties;
      }
      return result;
    }

    // Same type arrays: merge items
    if (a.type === 'array' && b.type === 'array') {
      const result = { type: 'array' };
      if (a.items && b.items) {
        result.items = merge(a.items, b.items);
      } else {
        result.items = a.items || b.items;
      }
      if (a.minItems !== undefined || b.minItems !== undefined) {
        result.minItems = Math.min(a.minItems ?? Infinity, b.minItems ?? Infinity);
        if (result.minItems === Infinity) delete result.minItems;
      }
      if (a.maxItems !== undefined || b.maxItems !== undefined) {
        result.maxItems = Math.max(a.maxItems ?? -Infinity, b.maxItems ?? -Infinity);
        if (result.maxItems === -Infinity) delete result.maxItems;
      }
      return result;
    }

    // Same simple type: merge constraints
    if (a.type === b.type) {
      const result = { ...a, ...b };
      if (a.minimum !== undefined && b.minimum !== undefined) result.minimum = Math.min(a.minimum, b.minimum);
      if (a.maximum !== undefined && b.maximum !== undefined) result.maximum = Math.max(a.maximum, b.maximum);
      if (a.minLength !== undefined && b.minLength !== undefined) result.minLength = Math.min(a.minLength, b.minLength);
      if (a.maxLength !== undefined && b.maxLength !== undefined) result.maxLength = Math.max(a.maxLength, b.maxLength);
      if (a.enum && b.enum) result.enum = [...new Set([...a.enum, ...b.enum])];
      return result;
    }

    // Different types: oneOf
    return { oneOf: [a, b] };
  }

  let result = { ...schemas[0] };
  for (let i = 1; i < schemas.length; i++) {
    result = merge(result, schemas[i]);
  }

  if (!result.$schema) result.$schema = 'http://json-schema.org/draft-07/schema#';
  return result;
}

// ─── 7. Schema to Documentation ──────────────────────────────────────────────

function schemaToDocs(schema, options = {}) {
  const { title = schema.title || 'Schema Documentation', depth = 0 } = options;
  const lines = [];

  lines.push(`# ${title}`);
  lines.push('');
  if (schema.description) {
    lines.push(schema.description);
    lines.push('');
  }

  function docType(sch, indent = 0) {
    if (!sch) return;
    const prefix = '  '.repeat(indent);

    if (sch.type === 'object' && sch.properties) {
      const required = new Set(sch.required || []);
      lines.push(`${prefix}| Property | Type | Required | Description |`);
      lines.push(`${prefix}|----------|------|----------|-------------|`);

      for (const [key, prop] of Object.entries(sch.properties)) {
        const typeStr = formatType(prop);
        const req = required.has(key) ? 'Yes' : 'No';
        const desc = prop.description || formatConstraints(prop);
        lines.push(`${prefix}| \`${key}\` | ${typeStr} | ${req} | ${desc} |`);
      }
      lines.push('');

      // Detail nested objects
      for (const [key, prop] of Object.entries(sch.properties)) {
        if (prop.type === 'object' && prop.properties) {
          lines.push(`## ${key}`);
          lines.push('');
          if (prop.description) {
            lines.push(prop.description);
            lines.push('');
          }
          docType(prop, indent);
        } else if (prop.type === 'array' && prop.items && prop.items.type === 'object') {
          lines.push(`## ${key}[] items`);
          lines.push('');
          docType(prop.items, indent);
        }
      }
    }
  }

  function formatType(sch) {
    if (!sch) return 'unknown';
    if (sch.enum) return sch.enum.map(v => `\`${v}\``).join(' \\| ');
    if (sch.oneOf) return sch.oneOf.map(formatType).join(' \\| ');
    if (sch.anyOf) return sch.anyOf.map(formatType).join(' \\| ');

    let t = Array.isArray(sch.type) ? sch.type.join(' \\| ') : (sch.type || 'unknown');
    if (sch.format) t += ` (${sch.format})`;
    if (sch.type === 'array' && sch.items) t = `${formatType(sch.items)}[]`;
    return t;
  }

  function formatConstraints(sch) {
    const parts = [];
    if (sch.minimum !== undefined) parts.push(`min: ${sch.minimum}`);
    if (sch.maximum !== undefined) parts.push(`max: ${sch.maximum}`);
    if (sch.minLength !== undefined) parts.push(`minLen: ${sch.minLength}`);
    if (sch.maxLength !== undefined) parts.push(`maxLen: ${sch.maxLength}`);
    if (sch.pattern) parts.push(`pattern: \`${sch.pattern}\``);
    if (sch.format) parts.push(`format: ${sch.format}`);
    if (sch.default !== undefined) parts.push(`default: ${JSON.stringify(sch.default)}`);
    if (sch.enum) parts.push(`enum: ${sch.enum.join(', ')}`);
    return parts.join(', ');
  }

  docType(schema);

  // Add examples section if default or examples exist
  if (schema.examples) {
    lines.push('## Examples');
    lines.push('');
    for (const ex of schema.examples) {
      lines.push('```json');
      lines.push(JSON.stringify(ex, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── 8. OpenAPI Extraction ────────────────────────────────────────────────────

function extractFromOpenApi(spec) {
  const schemas = {};

  // Extract component schemas
  if (spec.components && spec.components.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      schemas[name] = resolveRefs(schema, spec);
    }
  }

  // Extract per-endpoint request/response schemas
  const endpoints = [];
  if (spec.paths) {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].indexOf(method) === -1) continue;

        const endpoint = {
          method: method.toUpperCase(),
          path,
          operationId: operation.operationId || null,
          summary: operation.summary || null,
          request: null,
          responses: {},
          parameters: [],
        };

        // Parameters
        if (operation.parameters) {
          for (const param of operation.parameters) {
            const resolved = param.$ref ? resolveRef(param.$ref, spec) : param;
            endpoint.parameters.push({
              name: resolved.name,
              in: resolved.in,
              required: resolved.required || false,
              schema: resolved.schema ? resolveRefs(resolved.schema, spec) : null,
            });
          }
        }

        // Request body
        if (operation.requestBody) {
          const body = operation.requestBody.$ref
            ? resolveRef(operation.requestBody.$ref, spec)
            : operation.requestBody;
          if (body.content) {
            for (const [mediaType, content] of Object.entries(body.content)) {
              if (content.schema) {
                endpoint.request = {
                  mediaType,
                  schema: resolveRefs(content.schema, spec),
                };
                break;
              }
            }
          }
        }

        // Responses
        if (operation.responses) {
          for (const [statusCode, response] of Object.entries(operation.responses)) {
            const resp = response.$ref ? resolveRef(response.$ref, spec) : response;
            if (resp.content) {
              for (const [mediaType, content] of Object.entries(resp.content)) {
                if (content.schema) {
                  endpoint.responses[statusCode] = {
                    description: resp.description || '',
                    mediaType,
                    schema: resolveRefs(content.schema, spec),
                  };
                  break;
                }
              }
            } else {
              endpoint.responses[statusCode] = {
                description: resp.description || '',
                mediaType: null,
                schema: null,
              };
            }
          }
        }

        endpoints.push(endpoint);
      }
    }
  }

  return { schemas, endpoints };
}

function resolveRef(ref, spec) {
  const parts = ref.replace('#/', '').split('/');
  let current = spec;
  for (const part of parts) {
    current = current[part];
    if (!current) return {};
  }
  return current;
}

function resolveRefs(schema, spec, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return schema;

  if (schema.$ref) {
    if (seen.has(schema.$ref)) return { $ref: schema.$ref, _circular: true };
    seen.add(schema.$ref);
    const resolved = resolveRef(schema.$ref, spec);
    return resolveRefs(resolved, spec, new Set(seen));
  }

  const result = Array.isArray(schema) ? [] : {};
  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = resolveRefs(value, spec, new Set(seen));
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generateSchema,
  validateJson,
  diffSchemas,
  schemaToTypescript,
  schemaToMock,
  mergeSchemas,
  schemaToDocs,
  extractFromOpenApi,
};
