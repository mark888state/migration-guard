import { splitStatements, parseStatement } from './parser.js';

const rules = [
  ['MG001', 'ADD COLUMN NOT NULL without a default', 'Backfill in batches, then add the NOT NULL constraint separately.'],
  ['MG002', 'ADD COLUMN DEFAULT may rewrite a large table before PostgreSQL 11', 'Upgrade PostgreSQL or use an expand/backfill/contract migration.'],
  ['MG003', 'ADD COLUMN uses a volatile DEFAULT', 'Add the column nullable, backfill in batches, then set the default.'],
  ['MG004', 'SET NOT NULL without a validated CHECK constraint', 'Add CHECK (column IS NOT NULL) NOT VALID, validate it, then SET NOT NULL.'],
  ['MG005', 'CREATE INDEX without CONCURRENTLY', 'Use CREATE INDEX CONCURRENTLY in a separate, non-transactional migration.'],
  ['MG006', 'DROP INDEX without CONCURRENTLY', 'Use DROP INDEX CONCURRENTLY outside a transaction.'],
  ['MG007', 'ADD FOREIGN KEY without NOT VALID', 'Add the foreign key NOT VALID, then VALIDATE CONSTRAINT separately.'],
  ['MG008', 'ADD CHECK constraint without NOT VALID', 'Add the constraint NOT VALID and validate it in a later step.'],
  ['MG009', 'ALTER COLUMN TYPE may rewrite or lock the table', 'Use an expand/backfill/contract migration and verify the cast is online-safe.'],
  ['MG010', 'ADD PRIMARY KEY may scan and lock the table', 'Create a UNIQUE INDEX CONCURRENTLY, then attach it as a constraint.'],
  ['MG011', 'DROP COLUMN breaks older application versions', 'Deploy code that no longer reads/writes the column before dropping it.'],
  ['MG012', 'RENAME COLUMN breaks older application versions', 'Add a new column, dual-write, backfill, switch reads, then remove the old column.'],
  ['MG013', 'DROP TABLE is destructive and blocks old application versions', 'Use an expand/contract rollout and drop only after all consumers are upgraded.']
];
const volatile = /\b(?:clock_timestamp|timeofday|random|nextval|gen_random_uuid|uuid_generate_v[1-7])\s*\(/i;
const id = value => value?.replaceAll('"', '').toLowerCase();
const rule = (code, file, line, detail = '') => {
  const [, title, fix] = rules.find(item => item[0] === code);
  return { rule: code, title, file, line, detail, fix };
};
export function analyze(sql, file = '<input>', options = {}) {
  const major = Number(options.postgresMajor ?? 14);
  const parsed = splitStatements(sql).map(parseStatement);
  const findings = [], validatedChecks = new Set(), pendingChecks = new Map();
  const largeTables = (options.largeTables || []).map(id);
  for (const s of parsed) {
    if (s.kind === 'alter-table') {
      const table = id(s.table);
      for (const action of s.actions) {
        const check = action.match(/^ADD\s+(?:CONSTRAINT\s+(\S+)\s+)?CHECK\s*\(\s*("?[\w$]+"?)\s+IS\s+NOT\s+NULL\s*\)\s+NOT\s+VALID/i);
        if (check) {
          if (!pendingChecks.has(table)) pendingChecks.set(table, new Map());
          pendingChecks.get(table).set(id(check[1] || ''), id(check[2]));
        }
        const validation = action.match(/^VALIDATE\s+CONSTRAINT\s+(\S+)/i);
        if (validation && pendingChecks.get(table)?.has(id(validation[1]))) {
          const checkedColumn = pendingChecks.get(table).get(id(validation[1]));
          validatedChecks.add(`${table}:${checkedColumn}`);
        }
        if (/^ADD\s+(?:COLUMN\s+)?/i.test(action)) {
          const col = action.match(/^ADD\s+(?:COLUMN\s+)?("?[\w$]+"?)/i)?.[1];
          if (col && /\bNOT\s+NULL\b/i.test(action) && !/\bDEFAULT\b/i.test(action)) findings.push(rule('MG001', file, s.line, `${s.table}.${col}`));
          const def = action.match(/\bDEFAULT\s+(.+)$/i)?.[1] || '';
          if (def && major < 11 && (!largeTables.length || largeTables.includes(table))) findings.push(rule('MG002', file, s.line, `${s.table}.${col || 'column'} (PostgreSQL ${major})`));
          else if (def && volatile.test(def)) findings.push(rule('MG003', file, s.line, `${s.table}.${col || 'column'}`));
          if (/^ADD\s+(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\b/i.test(action) && !/\bNOT\s+VALID\b/i.test(action)) findings.push(rule('MG007', file, s.line, s.table));
          if (/^ADD\s+(?:CONSTRAINT\s+\S+\s+)?CHECK\b/i.test(action) && !/\bNOT\s+VALID\b/i.test(action)) findings.push(rule('MG008', file, s.line, s.table));
          if (/^ADD\s+(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\b/i.test(action)) findings.push(rule('MG010', file, s.line, s.table));
        }
        const setNN = action.match(/^ALTER\s+COLUMN\s+("?[\w$]+"?)\s+SET\s+NOT\s+NULL/i);
        if (setNN) {
          const col = id(setNN[1]);
          const safe = validatedChecks.has(`${table}:${col}`);
          if (!safe) findings.push(rule('MG004', file, s.line, `${s.table}.${setNN[1]}`));
        }
        if (/^ALTER\s+COLUMN\s+.+?\s+(?:TYPE|SET\s+DATA\s+TYPE)\b/i.test(action)) findings.push(rule('MG009', file, s.line, `${s.table}: ${action}`));
        if (/^DROP\s+COLUMN\b/i.test(action)) findings.push(rule('MG011', file, s.line, `${s.table}: ${action}`));
        if (/^RENAME\s+COLUMN\b/i.test(action)) findings.push(rule('MG012', file, s.line, `${s.table}: ${action}`));
      }
    }
    if (s.kind === 'create-index' && !s.concurrent) findings.push(rule('MG005', file, s.line, s.table));
    if (s.kind === 'drop-index' && !s.concurrent) findings.push(rule('MG006', file, s.line));
    if (s.kind === 'drop-table') findings.push(rule('MG013', file, s.line, s.sql));
  }
  return findings;
}
export const ruleCatalog = rules.map(([code, title, fix]) => ({ code, title, fix }));

// ruleset rev 13

// ruleset rev 14

// ruleset rev 15

// ruleset rev 16

// ruleset rev 17

// ruleset rev 18

// ruleset rev 19

// ruleset rev 20

// ruleset rev 21

// ruleset rev 22

// ruleset rev 23

// ruleset rev 24

// ruleset rev 25

// ruleset rev 26

// ruleset rev 27

// ruleset rev 28

// ruleset rev 29

// ruleset rev 30

// ruleset rev 31

// ruleset rev 32

// ruleset rev 33

// ruleset rev 34
