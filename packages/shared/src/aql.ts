export type ListCustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'select'
  | 'checkbox'
  | 'ref';

export interface ListCustomFieldDefinition {
  key: string;
  label: string;
  type: ListCustomFieldType;
  options?: string[];
  markdown?: boolean;
}

export interface AqlItem {
  id?: string;
  title: string;
  url?: string;
  notes?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  addedAt?: string;
  updatedAt?: string;
  touchedAt?: string;
  position?: number;
  completed?: boolean;
  completedAt?: string;
  instanceId?: string;
  favorite?: boolean;
  pinned?: boolean;
}

export type AqlParseResult =
  | { ok: true; query: AqlQuery }
  | { ok: false; error: string };

export type AqlValue = string | number | boolean;

export type AqlOperator =
  | 'contains'
  | 'not_contains'
  | 'similar'
  | 'not_similar'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'is_empty'
  | 'is_not_empty';

export type AqlExpr =
  | { type: 'and'; left: AqlExpr; right: AqlExpr }
  | { type: 'or'; left: AqlExpr; right: AqlExpr }
  | { type: 'not'; expr: AqlExpr }
  | { type: 'clause'; clause: AqlClause };

export type AqlFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'checkbox'
  | 'ref'
  | 'tag'
  | 'boolean'
  | 'position';

export interface AqlField {
  key: string;
  label: string;
  type: AqlFieldType;
  kind: 'builtin' | 'custom';
  displayable: boolean;
}

export interface AqlClause {
  field: AqlField;
  op: AqlOperator;
  value?: AqlValue;
  values?: AqlValue[];
}

export interface AqlOrderBy {
  field: AqlField;
  direction: 'asc' | 'desc';
}

export interface AqlQuery {
  where: AqlExpr | null;
  orderBy: AqlOrderBy[];
  show: AqlField[] | null;
  base: string;
}

export interface AqlParseOptions {
  customFields: ListCustomFieldDefinition[];
  builtinFields?: AqlBuiltinField[];
  allowedFields?: string[];
  allowOrderBy?: boolean;
  allowShow?: boolean;
}

export type AqlBuiltinField = Omit<AqlField, 'label'> & { name: string; label: string };

type TokenType =
  | 'identifier'
  | 'string'
  | 'number'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'keyword';

type Token = {
  type: TokenType;
  value: string;
  start: number;
  end: number;
};

const KEYWORDS = new Set([
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'EMPTY',
  'ORDER',
  'BY',
  'SHOW',
  'ASC',
  'DESC',
]);

export const DEFAULT_AQL_BUILTIN_FIELDS: AqlBuiltinField[] = [
  { name: 'text', key: 'text', label: 'Text', type: 'text', kind: 'builtin', displayable: false },
  { name: 'title', key: 'title', label: 'Title', type: 'text', kind: 'builtin', displayable: true },
  { name: 'notes', key: 'notes', label: 'Notes', type: 'text', kind: 'builtin', displayable: true },
  { name: 'url', key: 'url', label: 'URL', type: 'text', kind: 'builtin', displayable: true },
  { name: 'tag', key: 'tags', label: 'Tags', type: 'tag', kind: 'builtin', displayable: true },
  { name: 'tags', key: 'tags', label: 'Tags', type: 'tag', kind: 'builtin', displayable: true },
  { name: 'added', key: 'added', label: 'Added', type: 'datetime', kind: 'builtin', displayable: true },
  { name: 'updated', key: 'updated', label: 'Updated', type: 'datetime', kind: 'builtin', displayable: true },
  { name: 'touched', key: 'touched', label: 'Touched', type: 'datetime', kind: 'builtin', displayable: true },
  { name: 'completed', key: 'completed', label: 'Completed', type: 'boolean', kind: 'builtin', displayable: false },
  { name: 'position', key: 'position', label: 'Position', type: 'position', kind: 'builtin', displayable: false },
];

function buildFieldMap(
  customFields: ListCustomFieldDefinition[],
  builtinFields: AqlBuiltinField[],
): {
  map: Map<string, AqlField>;
  ambiguous: Set<string>;
} {
  const map = new Map<string, AqlField>();
  const ambiguous = new Set<string>();

  const addField = (name: string, field: AqlField) => {
    const key = name.trim().toLowerCase();
    if (!key) return;
    if (map.has(key)) {
      const existing = map.get(key);
      if (existing && existing.key !== field.key) {
        ambiguous.add(key);
      }
      return;
    }
    map.set(key, field);
  };

  for (const entry of builtinFields) {
    addField(entry.name, {
      key: entry.key,
      label: entry.label,
      type: entry.type,
      kind: entry.kind,
      displayable: entry.displayable,
    });
  }

  for (const field of customFields) {
    const key = field.key?.trim();
    if (!key) continue;
    const type: AqlFieldType =
      field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'time'
            ? 'time'
            : field.type === 'datetime'
              ? 'datetime'
              : field.type === 'checkbox'
                ? 'checkbox'
                : field.type === 'ref'
                  ? 'ref'
                  : 'text';
    const label = field.label?.trim() || key;
    const aqlField: AqlField = {
      key,
      label,
      type,
      kind: 'custom',
      displayable: true,
    };
    addField(key, aqlField);
    addField(label, aqlField);
  }

  return { map, ambiguous };
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i] ?? '';
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i += 1;
      continue;
    }

    const start = i;

    if (char === '(') {
      tokens.push({ type: 'lparen', value: '(', start, end: i + 1 });
      i += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: ')', start, end: i + 1 });
      i += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma', value: ',', start, end: i + 1 });
      i += 1;
      continue;
    }

    if (char === '!' || char === '>' || char === '<' || char === ':' || char === '=' || char === '~') {
      const two = input.slice(i, i + 2);
      if (two === '!=' || two === '>=' || two === '<=' || two === '!:' || two === '!~') {
        tokens.push({ type: 'operator', value: two, start, end: i + 2 });
        i += 2;
        continue;
      }
      tokens.push({ type: 'operator', value: char, start, end: i + 1 });
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      i += 1;
      let value = '';
      let escaped = false;
      while (i < input.length) {
        const c = input[i] ?? '';
        if (escaped) {
          value += c;
          escaped = false;
          i += 1;
          continue;
        }
        if (c === '\\') {
          escaped = true;
          i += 1;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      tokens.push({ type: 'string', value, start, end: i });
      continue;
    }

    const nextChar = input[i + 1];
    const isNumberStart =
      (char >= '0' && char <= '9') ||
      (char === '-' && typeof nextChar === 'string' && /\d/.test(nextChar));
    if (isNumberStart) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j] ?? '')) {
        j += 1;
      }
      const value = input.slice(i, j);
      tokens.push({ type: 'number', value, start, end: j });
      i = j;
      continue;
    }

    let j = i + 1;
    while (j < input.length && /[A-Za-z0-9_.\-]/.test(input[j] ?? '')) {
      j += 1;
    }
    const value = input.slice(i, j);
    const upper = value.toUpperCase();
    tokens.push({ type: KEYWORDS.has(upper) ? 'keyword' : 'identifier', value, start, end: j });
    i = j;
  }
  return tokens;
}

type RawAqlExpr =
  | { type: 'and'; left: RawAqlExpr; right: RawAqlExpr }
  | { type: 'or'; left: RawAqlExpr; right: RawAqlExpr }
  | { type: 'not'; expr: RawAqlExpr }
  | { type: 'clause'; clause: ClauseRaw };

class Parser {
  private index = 0;
  constructor(
    private readonly input: string,
    private readonly tokens: Token[],
  ) {}

  parseQuery(): {
    where: RawAqlExpr | null;
    orderBy: OrderByRaw[];
    show: string[] | null;
    base: string;
  } {
    const startIndex = this.peek();
    let where: RawAqlExpr | null = null;
    let whereEnd = startIndex?.start ?? 0;
    if (!this.isKeyword('SHOW') && !this.isKeyword('ORDER')) {
      where = this.parseExpression();
      const lastToken = this.tokens[this.index - 1];
      if (lastToken) {
        whereEnd = lastToken.end;
      }
    }

    const orderBy: OrderByRaw[] = [];
    let show: string[] | null = null;

    while (this.hasMore()) {
      if (this.matchKeyword('ORDER')) {
        this.expectKeyword('BY');
        orderBy.push(...this.parseOrderBy());
        continue;
      }
      if (this.matchKeyword('SHOW')) {
        show = this.parseShow();
        continue;
      }
      this.error('Unexpected token after query expression');
    }

    const base = where ? this.input.slice(0, whereEnd).trim() : '';
    return { where, orderBy, show, base };
  }

  parseExpression(): RawAqlExpr {
    return this.parseOr();
  }

  parseOr(): RawAqlExpr {
    let expr = this.parseAnd();
    while (this.matchKeyword('OR')) {
      const right = this.parseAnd();
      expr = { type: 'or', left: expr, right };
    }
    return expr;
  }

  parseAnd(): RawAqlExpr {
    let expr = this.parseUnary();
    while (this.matchKeyword('AND')) {
      const right = this.parseUnary();
      expr = { type: 'and', left: expr, right };
    }
    return expr;
  }

  parseUnary(): RawAqlExpr {
    if (this.matchKeyword('NOT')) {
      const expr = this.parseUnary();
      return { type: 'not', expr };
    }
    if (this.matchType('lparen')) {
      const expr = this.parseExpression();
      this.expectType('rparen');
      return expr;
    }
    return { type: 'clause', clause: this.parseClause() };
  }

  parseClause(): ClauseRaw {
    const fieldToken = this.expectField();
    const field = fieldToken.value;

    if (this.matchKeyword('IS')) {
      if (this.matchKeyword('NOT')) {
        this.expectKeyword('EMPTY');
        return { field, op: 'is_not_empty' };
      }
      this.expectKeyword('EMPTY');
      return { field, op: 'is_empty' };
    }

    if (this.matchKeyword('IN')) {
      this.expectType('lparen');
      const values = this.parseValueList();
      this.expectType('rparen');
      return { field, op: 'in', values };
    }

    const opToken = this.expectType('operator');
    const opValue = opToken.value;
    const op = opValue === ':'
      ? 'contains'
      : opValue === '!:'
        ? 'not_contains'
        : opValue === '~'
          ? 'similar'
          : opValue === '!~'
            ? 'not_similar'
            : opValue === '='
              ? 'eq'
              : opValue === '!='
                ? 'neq'
                : opValue === '>'
                  ? 'gt'
                  : opValue === '>='
                    ? 'gte'
                    : opValue === '<'
                      ? 'lt'
                      : opValue === '<='
                        ? 'lte'
                        : null;
    if (!op) {
      this.error(`Unsupported operator "${opValue}"`);
    }
    const value = this.parseValue();
    return { field, op, value };
  }

  parseValueList(): RawValue[] {
    const values: RawValue[] = [];
    if (this.peek()?.type === 'rparen') {
      return values;
    }
    values.push(this.parseValue());
    while (this.matchType('comma')) {
      values.push(this.parseValue());
    }
    return values;
  }

  parseShow(): string[] {
    const fields: string[] = [];
    if (this.peek()?.type === 'rparen' || !this.peek()) {
      this.error('SHOW requires at least one field');
    }
    const first = this.expectField();
    fields.push(first.value);
    while (this.matchType('comma')) {
      const next = this.expectField();
      fields.push(next.value);
    }
    return fields;
  }

  parseOrderBy(): OrderByRaw[] {
    const entries: OrderByRaw[] = [];
    const firstField = this.expectField();
    let direction: 'asc' | 'desc' = 'asc';
    if (this.matchKeyword('ASC')) direction = 'asc';
    if (this.matchKeyword('DESC')) direction = 'desc';
    entries.push({ field: firstField.value, direction });

    while (this.matchType('comma')) {
      const fieldToken = this.expectField();
      let dir: 'asc' | 'desc' = 'asc';
      if (this.matchKeyword('ASC')) dir = 'asc';
      if (this.matchKeyword('DESC')) dir = 'desc';
      entries.push({ field: fieldToken.value, direction: dir });
    }
    return entries;
  }

  parseValue(): RawValue {
    const token = this.peek();
    if (!token) {
      this.error('Expected value');
    }
    if (token.type === 'string' || token.type === 'number' || token.type === 'identifier') {
      this.index += 1;
      return { type: token.type, value: token.value };
    }
    this.error('Expected value');
  }

  expectField(): Token {
    const token = this.peek();
    if (!token) {
      this.error('Expected field');
    }
    if (token.type === 'identifier' || token.type === 'string') {
      this.index += 1;
      return token;
    }
    this.error('Expected field');
  }

  matchKeyword(keyword: string): boolean {
    const token = this.peek();
    if (token?.type === 'keyword' && token.value.toUpperCase() === keyword) {
      this.index += 1;
      return true;
    }
    return false;
  }

  isKeyword(keyword: string): boolean {
    const token = this.peek();
    return token?.type === 'keyword' && token.value.toUpperCase() === keyword;
  }

  expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      this.error(`Expected ${keyword}`);
    }
  }

  matchType(type: TokenType): boolean {
    const token = this.peek();
    if (token?.type === type) {
      this.index += 1;
      return true;
    }
    return false;
  }

  expectType(type: TokenType): Token {
    const token = this.peek();
    if (token?.type === type) {
      this.index += 1;
      return token;
    }
    this.error(`Expected ${type}`);
  }

  peek(): Token | undefined {
    return this.tokens[this.index];
  }

  hasMore(): boolean {
    return this.index < this.tokens.length;
  }

  error(message: string): never {
    throw new Error(message);
  }
}

type RawValue = { type: 'string' | 'number' | 'identifier'; value: string };

type ClauseRaw = {
  field: string;
  op: AqlOperator;
  value?: RawValue;
  values?: RawValue[];
};

type OrderByRaw = { field: string; direction: 'asc' | 'desc' };

export function parseAql(input: string, options: AqlParseOptions): AqlParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, query: { where: null, orderBy: [], show: null, base: '' } };
  }

  try {
    const tokens = tokenize(input);
    const parser = new Parser(input, tokens);
    const parsed = parser.parseQuery();
    if (parser.hasMore()) {
      return { ok: false, error: 'Unexpected tokens at end of query' };
    }
    return compileAql(parsed, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid query';
    return { ok: false, error: message };
  }
}

function compileAql(
  parsed: {
    where: RawAqlExpr | null;
    orderBy: OrderByRaw[];
    show: string[] | null;
    base: string;
  },
  options: AqlParseOptions,
): AqlParseResult {
  const builtinFields = options.builtinFields ?? DEFAULT_AQL_BUILTIN_FIELDS;
  const allowOrderBy = options.allowOrderBy !== false;
  const allowShow = options.allowShow !== false;
  const allowedFields = options.allowedFields
    ? new Set(options.allowedFields.map((field) => field.trim().toLowerCase()).filter(Boolean))
    : null;

  if (!allowOrderBy && parsed.orderBy.length > 0) {
    throw new Error('ORDER BY is not supported in this query');
  }
  if (!allowShow && parsed.show && parsed.show.length > 0) {
    throw new Error('SHOW is not supported in this query');
  }

  const assertAllowedField = (raw: string, context?: string) => {
    if (!allowedFields) {
      return;
    }
    const key = raw.trim().toLowerCase();
    if (!key || !allowedFields.has(key)) {
      const location = context ? ` in ${context}` : '';
      throw new Error(`Field "${raw}" is not supported${location}`);
    }
  };

  const validateExpr = (expr: RawAqlExpr): void => {
    if (expr.type === 'clause') {
      assertAllowedField(expr.clause.field);
      return;
    }
    if (expr.type === 'not') {
      validateExpr(expr.expr);
      return;
    }
    validateExpr(expr.left);
    validateExpr(expr.right);
  };

  if (parsed.where) {
    validateExpr(parsed.where);
  }
  if (parsed.orderBy.length > 0) {
    for (const entry of parsed.orderBy) {
      assertAllowedField(entry.field, 'ORDER BY');
    }
  }
  if (parsed.show) {
    for (const entry of parsed.show) {
      assertAllowedField(entry, 'SHOW');
    }
  }

  const { map, ambiguous } = buildFieldMap(options.customFields, builtinFields);

  const resolveField = (raw: string): AqlField | null => {
    const key = raw.trim().toLowerCase();
    if (!key) return null;
    if (ambiguous.has(key)) {
      throw new Error(`Field name "${raw}" is ambiguous`);
    }
    return map.get(key) ?? null;
  };

  const compileValue = (field: AqlField, op: AqlOperator, raw: RawValue): AqlValue => {
    const rawValue = raw.value;
    const lower = rawValue.toLowerCase();
    const isBoolean = lower === 'true' || lower === 'false';
    const isNumber = raw.type === 'number' && Number.isFinite(Number(rawValue));

    if (op === 'contains' || op === 'not_contains' || op === 'similar' || op === 'not_similar') {
      if (field.type !== 'text' && field.type !== 'tag' && field.type !== 'ref') {
        throw new Error(`Operator ${opSymbol(op)} is not supported for ${field.label}`);
      }
      return rawValue.toLowerCase();
    }

    if (op === 'eq' || op === 'neq' || op === 'in') {
      if (field.type === 'number' || field.type === 'position') {
        const num = isNumber ? Number(rawValue) : Number(rawValue);
        if (!Number.isFinite(num)) {
          throw new Error(`Expected a number for ${field.label}`);
        }
        return num;
      }
      if (field.type === 'date') {
        const parsed = parseDateToTimestamp(rawValue);
        if (parsed === null) {
          throw new Error(`Expected a date for ${field.label}`);
        }
        return parsed;
      }
      if (field.type === 'time') {
        const parsed = parseTimeToMinutes(rawValue);
        if (parsed === null) {
          throw new Error(`Expected a time for ${field.label}`);
        }
        return parsed;
      }
      if (field.type === 'datetime') {
        const parsed = parseDatetimeToTimestamp(rawValue);
        if (parsed === null) {
          throw new Error(`Expected a datetime for ${field.label}`);
        }
        return parsed;
      }
      if (field.type === 'checkbox' || field.type === 'boolean') {
        if (!isBoolean) {
          throw new Error(`Expected true/false for ${field.label}`);
        }
        return lower === 'true';
      }
      return rawValue.toLowerCase();
    }

    if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      if (field.type === 'number' || field.type === 'position') {
        const num = Number(rawValue);
        if (!Number.isFinite(num)) {
          throw new Error(`Expected a number for ${field.label}`);
        }
        return num;
      }
      if (field.type === 'date') {
        const parsed = parseDateToTimestamp(rawValue);
        if (parsed === null) {
          throw new Error(`Expected a date for ${field.label}`);
        }
        return parsed;
      }
      if (field.type === 'time') {
        const parsed = parseTimeToMinutes(rawValue);
        if (parsed === null) {
          throw new Error(`Expected a time for ${field.label}`);
        }
        return parsed;
      }
      if (field.type === 'datetime') {
        const parsed = parseDatetimeToTimestamp(rawValue);
        if (parsed === null) {
          throw new Error(`Expected a datetime for ${field.label}`);
        }
        return parsed;
      }
      throw new Error(`Operator ${opSymbol(op)} is not supported for ${field.label}`);
    }

    throw new Error('Invalid operator');
  };

  const getTextSearchFields = (customFields: ListCustomFieldDefinition[]): AqlField[] => {
    const fields: AqlField[] = [];
    const seen = new Set<string>();

    for (const entry of builtinFields) {
      if (entry.key === 'text') {
        continue;
      }
      if (entry.type !== 'text' && entry.type !== 'tag') {
        continue;
      }
      if (seen.has(entry.key)) {
        continue;
      }
      seen.add(entry.key);
      fields.push({
        key: entry.key,
        label: entry.label,
        type: entry.type,
        kind: entry.kind,
        displayable: entry.displayable,
      });
    }

    for (const field of customFields) {
      if (field.type !== 'text') {
        continue;
      }
      const key = field.key?.trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      fields.push({
        key,
        label: field.label?.trim() || key,
        type: 'text',
        kind: 'custom',
        displayable: true,
      });
    }

    return fields;
  };

  const buildClause = (field: AqlField, raw: ClauseRaw): AqlClause => {
    if (raw.op === 'is_empty' || raw.op === 'is_not_empty') {
      return { field, op: raw.op };
    }
    if (raw.op === 'in') {
      const rawValues = raw.values ?? [];
      if (rawValues.length === 0) {
        throw new Error('IN requires at least one value');
      }
      const values = rawValues.map((value) => compileValue(field, 'in', value));
      return { field, op: raw.op, values };
    }
    if (!raw.value) {
      throw new Error('Expected value');
    }
    const value = compileValue(field, raw.op, raw.value);
    return { field, op: raw.op, value };
  };

  const buildNeverMatchExpr = (field: AqlField): AqlExpr => ({
    type: 'and',
    left: { type: 'clause', clause: { field, op: 'is_empty' } },
    right: { type: 'clause', clause: { field, op: 'is_not_empty' } },
  });

  const compileClause = (raw: ClauseRaw): AqlExpr => {
    const field = resolveField(raw.field);
    if (!field) {
      throw new Error(`Unknown field "${raw.field}"`);
    }
    if (field.key === 'text') {
      if (
        raw.op !== 'contains' &&
        raw.op !== 'not_contains' &&
        raw.op !== 'similar' &&
        raw.op !== 'not_similar'
      ) {
        throw new Error(`Operator ${opSymbol(raw.op)} is not supported for ${field.label}`);
      }
      const textFields = getTextSearchFields(options.customFields);
      if (textFields.length === 0) {
        return buildNeverMatchExpr(field);
      }
      const clauses: AqlExpr[] = textFields.map((textField) => ({
        type: 'clause' as const,
        clause: buildClause(textField, raw),
      }));
      let expr = clauses[0]!;
      for (let i = 1; i < clauses.length; i += 1) {
        expr = { type: 'or', left: expr, right: clauses[i]! };
      }
      return expr;
    }
    return { type: 'clause', clause: buildClause(field, raw) };
  };

  const compileExpr = (expr: RawAqlExpr): AqlExpr => {
    if (expr.type === 'clause') {
      return compileClause(expr.clause);
    }
    if (expr.type === 'not') {
      return { type: 'not', expr: compileExpr(expr.expr) };
    }
    return { type: expr.type, left: compileExpr(expr.left), right: compileExpr(expr.right) };
  };

  let where: AqlExpr | null = null;
  if (parsed.where) {
    where = compileExpr(parsed.where);
  }

  const orderBy: AqlOrderBy[] = [];
  for (const entry of parsed.orderBy) {
    const field = resolveField(entry.field);
    if (!field) {
      throw new Error(`Unknown field "${entry.field}" in ORDER BY`);
    }
    orderBy.push({ field, direction: entry.direction });
  }

  let show: AqlField[] | null = null;
  if (parsed.show) {
    const showFields: AqlField[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.show) {
      const field = resolveField(raw);
      if (!field) {
        throw new Error(`Unknown field "${raw}" in SHOW`);
      }
      if (!field.displayable) {
        throw new Error(`Field "${raw}" cannot be shown`);
      }
      if (seen.has(field.key)) {
        continue;
      }
      seen.add(field.key);
      showFields.push(field);
    }
    show = showFields.length > 0 ? showFields : null;
  }

  return { ok: true, query: { where, orderBy, show, base: parsed.base } };
}

export interface AqlEvaluateOptions {
  isFieldSupported?: (field: AqlField) => boolean;
  getFieldValue?: (item: AqlItem, field: AqlField) => string | number | boolean | string[] | null;
}

export function evaluateAql(query: AqlQuery, item: AqlItem): boolean {
  return evaluateAqlWithOptions(query, item);
}

export function evaluateAqlWithOptions(
  query: AqlQuery,
  item: AqlItem,
  options?: AqlEvaluateOptions,
): boolean {
  if (!query.where) {
    return true;
  }
  return evaluateExpr(query.where, item, options);
}

function evaluateExpr(expr: AqlExpr, item: AqlItem, options?: AqlEvaluateOptions): boolean {
  if (expr.type === 'and') {
    return evaluateExpr(expr.left, item, options) && evaluateExpr(expr.right, item, options);
  }
  if (expr.type === 'or') {
    return evaluateExpr(expr.left, item, options) || evaluateExpr(expr.right, item, options);
  }
  if (expr.type === 'not') {
    return !evaluateExpr(expr.expr, item, options);
  }
  return evaluateClause(expr.clause, item, options);
}

function evaluateClause(
  clause: AqlClause,
  item: AqlItem,
  options?: AqlEvaluateOptions,
): boolean {
  if (options?.isFieldSupported && !options.isFieldSupported(clause.field)) {
    return false;
  }
  const { field, op } = clause;
  const value = options?.getFieldValue
    ? options.getFieldValue(item, field)
    : getFieldValue(item, field);

  if (op === 'is_empty') {
    return isEmptyValue(value, field.type);
  }
  if (op === 'is_not_empty') {
    return !isEmptyValue(value, field.type);
  }

  if (field.type === 'tag') {
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean)
      : [];
    const rawValue = clause.value as string | undefined;
    if (op === 'contains' || op === 'similar') {
      return rawValue ? tags.some((tag) => tag.includes(rawValue)) : false;
    }
    if (op === 'not_contains' || op === 'not_similar') {
      return rawValue ? tags.every((tag) => !tag.includes(rawValue)) : true;
    }
    if (op === 'eq') {
      return rawValue ? tags.some((tag) => tag === rawValue) : false;
    }
    if (op === 'neq') {
      return rawValue ? tags.every((tag) => tag !== rawValue) : true;
    }
    if (op === 'in') {
      const values = (clause.values as string[] | undefined) ?? [];
      return values.length > 0 ? tags.some((tag) => values.includes(tag)) : false;
    }
    return false;
  }

  if (field.type === 'text' || field.type === 'ref') {
    const text = typeof value === 'string' ? value.toLowerCase() : '';
    const rawValue = clause.value as string | undefined;
    if (op === 'contains' || op === 'similar') {
      return rawValue ? text.includes(rawValue) : false;
    }
    if (op === 'not_contains' || op === 'not_similar') {
      return rawValue ? !text.includes(rawValue) : true;
    }
    if (op === 'eq') {
      return rawValue ? text === rawValue : false;
    }
    if (op === 'neq') {
      return rawValue ? text !== rawValue : true;
    }
    if (op === 'in') {
      const values = (clause.values as string[] | undefined) ?? [];
      return values.length > 0 ? values.includes(text) : false;
    }
    return false;
  }

  if (field.type === 'checkbox' || field.type === 'boolean') {
    const boolValue = typeof value === 'boolean' ? value : null;
    const rawValue = clause.value as boolean | undefined;
    if (op === 'eq') {
      return boolValue === rawValue;
    }
    if (op === 'neq') {
      return boolValue !== rawValue;
    }
    if (op === 'in') {
      const values = (clause.values as boolean[] | undefined) ?? [];
      return boolValue !== null ? values.includes(boolValue) : false;
    }
    return false;
  }

  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (numericValue === null) {
    if (op === 'neq') {
      return true;
    }
    return false;
  }

  const rawNumber = clause.value as number | undefined;
  if (op === 'eq') {
    return numericValue === rawNumber;
  }
  if (op === 'neq') {
    return numericValue !== rawNumber;
  }
  if (op === 'gt') {
    return numericValue > (rawNumber ?? 0);
  }
  if (op === 'gte') {
    return numericValue >= (rawNumber ?? 0);
  }
  if (op === 'lt') {
    return numericValue < (rawNumber ?? 0);
  }
  if (op === 'lte') {
    return numericValue <= (rawNumber ?? 0);
  }
  if (op === 'in') {
    const values = (clause.values as number[] | undefined) ?? [];
    return values.length > 0 ? values.includes(numericValue) : false;
  }

  return false;
}

const normalizeString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const getReferenceLabel = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw['kind'] !== 'panel') {
    return null;
  }
  const id = normalizeString(raw['id']);
  if (!id) {
    return null;
  }
  const label = normalizeString(raw['label']);
  return (label || id).toLowerCase();
};

function getFieldValue(
  item: AqlItem,
  field: AqlField,
): string | number | boolean | string[] | null {
  if (field.kind === 'custom') {
    const value = item.customFields?.[field.key];
    if (value === null || value === undefined) return null;
    if (field.type === 'number') {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }
    if (field.type === 'checkbox') {
      return value === true;
    }
    if (field.type === 'date') {
      if (typeof value === 'string') return parseDateToTimestamp(value);
      return null;
    }
    if (field.type === 'time') {
      if (typeof value === 'string') return parseTimeToMinutes(value);
      return null;
    }
    if (field.type === 'datetime') {
      if (typeof value === 'string') return parseDatetimeToTimestamp(value);
      return null;
    }
    if (field.type === 'ref') {
      const label = getReferenceLabel(value);
      return label ?? null;
    }
    if (typeof value === 'string') return value.toLowerCase();
    return String(value).toLowerCase();
  }

  switch (field.key) {
    case 'title':
      return item.title.toLowerCase();
    case 'notes':
      return (item.notes ?? '').toLowerCase();
    case 'url':
      return (item.url ?? '').toLowerCase();
    case 'tags':
      return Array.isArray(item.tags)
        ? item.tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean)
        : [];
    case 'added':
      return parseDatetimeToTimestamp(item.addedAt ?? '') ?? null;
    case 'updated':
      return parseDatetimeToTimestamp(item.updatedAt ?? '') ?? null;
    case 'touched':
      return parseDatetimeToTimestamp(item.touchedAt ?? '') ?? null;
    case 'completed':
      return typeof item.completed === 'boolean' ? item.completed : false;
    case 'instance':
      return typeof item.instanceId === 'string' ? item.instanceId.toLowerCase() : null;
    case 'favorite':
      return typeof item.favorite === 'boolean' ? item.favorite : null;
    case 'pinned':
      return typeof item.pinned === 'boolean' ? item.pinned : null;
    case 'position':
      return typeof item.position === 'number' ? item.position : null;
    default:
      return null;
  }
}

function isEmptyValue(
  value: string | number | boolean | string[] | null,
  type: AqlFieldType,
): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (type === 'text' || type === 'ref') {
    return typeof value === 'string' ? value.trim().length === 0 : false;
  }
  if (type === 'tag') {
    return Array.isArray(value) ? value.length === 0 : true;
  }
  return false;
}

export function sortItemsByOrderBy(
  items: AqlItem[],
  orderBy: AqlOrderBy[],
  customFields: ListCustomFieldDefinition[],
): AqlItem[] {
  if (!orderBy || orderBy.length === 0) {
    return items;
  }

  const compare = (a: AqlItem, b: AqlItem): number => {
    for (const entry of orderBy) {
      const key = entry.field.key;
      const direction = entry.direction;
      const sortType = getSortTypeForField(key, customFields);
      const av = getComparableValue(a, key, sortType);
      const bv = getComparableValue(b, key, sortType);
      const result = compareValues(av, bv, direction);
      if (result !== 0) {
        return result;
      }
    }
    return 0;
  };

  const uncompleted = items.filter((item) => !item.completed).sort(compare);
  const completed = items.filter((item) => item.completed).sort(compare);
  return [...uncompleted, ...completed];
}

export function getShowColumnOrder(show: AqlField[] | null): string[] | null {
  if (!show || show.length === 0) {
    return null;
  }
  return show.map((field) => field.key);
}

export function buildAqlString(base: string, orderBy: AqlOrderBy[], show: AqlField[] | null): string {
  const parts: string[] = [];
  const baseText = base.trim();
  if (baseText.length > 0) {
    parts.push(baseText);
  }
  if (show && show.length > 0) {
    parts.push(`SHOW ${show.map((field) => field.key).join(', ')}`);
  }
  if (orderBy.length > 0) {
    const order = orderBy
      .map((entry) => `${entry.field.key} ${entry.direction.toUpperCase()}`.trim())
      .join(', ');
    parts.push(`ORDER BY ${order}`);
  }
  return parts.join(' ').trim();
}

function opSymbol(op: AqlOperator): string {
  if (op === 'contains') return ':';
  if (op === 'not_contains') return '!:';
  if (op === 'similar') return '~';
  if (op === 'not_similar') return '!~';
  if (op === 'eq') return '=';
  if (op === 'neq') return '!=';
  if (op === 'gt') return '>';
  if (op === 'gte') return '>=';
  if (op === 'lt') return '<';
  if (op === 'lte') return '<=';
  if (op === 'in') return 'IN';
  if (op === 'is_empty') return 'IS EMPTY';
  if (op === 'is_not_empty') return 'IS NOT EMPTY';
  return '';
}

function parseTimeToMinutes(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  return hours * 60 + minutes;
}

function parseDateToTimestamp(dateStr: string): number | null {
  const date = new Date(dateStr.trim() + 'T00:00:00');
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function parseDatetimeToTimestamp(datetimeStr: string): number | null {
  const date = new Date(datetimeStr.trim());
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function getSortTypeForField(
  columnKey: string,
  customFields: ListCustomFieldDefinition[],
): 'text' | 'number' | 'date' | 'time' | 'datetime' | 'checkbox' | 'position' {
  if (columnKey === 'position') return 'position';
  if (columnKey === 'title') return 'text';
  if (columnKey === 'url') return 'text';
  if (columnKey === 'notes') return 'text';
  if (columnKey === 'tags') return 'text';
  if (columnKey === 'added') return 'datetime';
  if (columnKey === 'updated') return 'datetime';
  if (columnKey === 'touched') return 'datetime';

  const field = customFields.find((f) => f.key === columnKey);
  if (!field) return 'text';

  switch (field.type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'datetime':
      return 'datetime';
    case 'checkbox':
      return 'checkbox';
    case 'select':
    case 'ref':
    case 'text':
    default:
      return 'text';
  }
}

function getComparableValue(
  item: AqlItem,
  columnKey: string,
  sortType: ReturnType<typeof getSortTypeForField>,
): string | number | boolean | null {
  if (columnKey === 'position') {
    return item.position ?? 0;
  }
  if (columnKey === 'title') {
    return item.title.toLowerCase();
  }
  if (columnKey === 'url') {
    return (item.url ?? '').toLowerCase();
  }
  if (columnKey === 'notes') {
    return (item.notes ?? '').toLowerCase();
  }
  if (columnKey === 'tags') {
    return (item.tags ?? []).join(', ').toLowerCase();
  }
  if (columnKey === 'added') {
    return parseDatetimeToTimestamp(item.addedAt ?? '') ?? 0;
  }
  if (columnKey === 'updated') {
    return parseDatetimeToTimestamp(item.updatedAt ?? '') ?? null;
  }
  if (columnKey === 'touched') {
    return parseDatetimeToTimestamp(item.touchedAt ?? '') ?? null;
  }

  const value = item.customFields?.[columnKey];
  if (value === null || value === undefined) {
    return null;
  }

  switch (sortType) {
    case 'number':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return Number.isNaN(parsed) ? null : parsed;
      }
      return null;
    case 'date':
      if (typeof value === 'string') return parseDateToTimestamp(value);
      return null;
    case 'time':
      if (typeof value === 'string') return parseTimeToMinutes(value);
      return null;
    case 'datetime':
      if (typeof value === 'string') return parseDatetimeToTimestamp(value);
      return null;
    case 'checkbox':
      return value === true;
    case 'text':
    default:
      if (typeof value === 'string') return value.toLowerCase();
      const referenceLabel = getReferenceLabel(value);
      if (referenceLabel) {
        return referenceLabel;
      }
      return String(value).toLowerCase();
  }
}

function compareValues(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
  direction: 'asc' | 'desc',
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  let result: number;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    result = a === b ? 0 : a ? -1 : 1;
  } else if (typeof a === 'number' && typeof b === 'number') {
    result = a - b;
  } else if (typeof a === 'string' && typeof b === 'string') {
    result = a.localeCompare(b);
  } else {
    result = String(a).localeCompare(String(b));
  }

  return direction === 'desc' ? -result : result;
}
