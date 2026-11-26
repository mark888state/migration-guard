// A small PostgreSQL-aware statement lexer. It is deliberately not a full SQL grammar.
export function splitStatements(source) {
  const result = [];
  let sql = '', state = 'normal', dollar = '', line = 1, startLine = 1, blockDepth = 0;
  const push = () => {
    const value = sql.trim();
    if (value) result.push({ sql: value, line: startLine });
    sql = '';
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (state === 'line') {
      if (c === '\n') { state = 'normal'; sql += '\n'; line++; }
      continue;
    }
    if (state === 'block') {
      if (c === '/' && n === '*') { blockDepth++; i++; continue; }
      if (c === '*' && n === '/') { if (--blockDepth === 0) state = 'normal'; i++; continue; }
      if (c === '\n') line++;
      continue;
    }
    if (state === 'single' || state === 'double') {
      sql += c;
      if (c === '\n') line++;
      if (c === (state === 'single' ? "'" : '"')) {
        if (n === c) { sql += n; i++; }
        else state = 'normal';
      } else if (c === '\\' && state === 'single' && n) { sql += n; i++; if (n === '\n') line++; }
      continue;
    }
    if (state === 'dollar') {
      if (source.startsWith(dollar, i)) { sql += dollar; i += dollar.length - 1; state = 'normal'; }
      else { sql += c; if (c === '\n') line++; }
      continue;
    }
    if (c === '-' && n === '-') { state = 'line'; i++; continue; }
    if (c === '/' && n === '*') { state = 'block'; blockDepth = 1; i++; continue; }
    if (c === "'") { state = 'single'; sql += c; continue; }
    if (c === '"') { state = 'double'; sql += c; continue; }
    if (c === '$') {
      const match = source.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) { dollar = match[0]; state = 'dollar'; sql += dollar; i += dollar.length - 1; continue; }
    }
    if (c === ';') { push(); startLine = line; continue; }
    sql += c;
    if (c === '\n') line++;
    if (!sql.trim()) startLine = line;
  }
  push();
  return result;
}

export function splitTopLevel(input) {
  const parts = []; let part = '', depth = 0, quote = null, dollar = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (dollar) { if (input.startsWith(dollar, i)) { part += dollar; i += dollar.length - 1; dollar = null; } else part += c; continue; }
    if (quote) {
      part += c;
      if (c === quote) { if (n === quote) { part += n; i++; } else quote = null; }
      else if (c === '\\' && quote === "'" && n) { part += n; i++; }
      continue;
    }
    if (c === "'" || c === '"') { quote = c; part += c; continue; }
    if (c === '$') { const m = input.slice(i).match(/^\$[A-Za-z_0-9]*\$/); if (m) { dollar = m[0]; part += dollar; i += dollar.length - 1; continue; } }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(part.trim()); part = ''; } else part += c;
  }
  if (part.trim()) parts.push(part.trim());
  return parts;
}

const IDENT = '(?:"(?:[^"]|"")+"|[A-Za-z_][\\w$]*)';
export function parseStatement(statement) {
  const sql = statement.sql.trim();
  const alter = sql.match(new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${IDENT}(?:\\s*\\.\\s*${IDENT})?)\\s+`, 'i'));
  if (alter) return { ...statement, kind: 'alter-table', table: alter[1].replaceAll('"', '').split('.').at(-1).trim(), actions: splitTopLevel(sql.slice(alter[0].length)) };
  const create = sql.match(new RegExp(`^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s+ON\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT})?)`, 'i'));
  if (create) return { ...statement, kind: 'create-index', concurrent: Boolean(create[2]), unique: Boolean(create[1]), table: create[3].replaceAll('"', '').split('.').at(-1).trim() };
  const dropIndex = sql.match(/^DROP\\s+INDEX\\s+(CONCURRENTLY\\s+)?/i);
  if (dropIndex) return { ...statement, kind: 'drop-index', concurrent: Boolean(dropIndex[1]) };
  if (/^DROP\\s+TABLE\\b/i.test(sql)) return { ...statement, kind: 'drop-table' };
  return { ...statement, kind: 'other' };
}
