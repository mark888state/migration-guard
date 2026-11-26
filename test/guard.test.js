import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, ruleCatalog } from '../src/rules.js';
import { splitStatements } from '../src/parser.js';

const codes = (sql, options) => analyze(sql, 'fixture.sql', options).map(f => f.rule);

test('lexer ignores semicolons inside strings, comments and dollar quotes', () => {
  const parsed = splitStatements("SELECT ';'; -- ;\n SELECT $$a;b$$; /* ; */ SELECT 3;");
  assert.equal(parsed.length, 3);
});
test('tracks line numbers after leading line and nested block comments', () => {
  assert.equal(splitStatements('-- header\nSELECT 1;')[0].line, 2);
  assert.equal(splitStatements('/* header\n /* nested */\n */\nSELECT 1;')[0].line, 4);
});
test('flags NOT NULL column addition without a default', () => {
  assert.ok(codes('ALTER TABLE users ADD COLUMN email text NOT NULL;').includes('MG001'));
});
test('PG 10 flags defaults conservatively unless explicitly scoped', () => {
  const sql = "ALTER TABLE users ADD COLUMN status text DEFAULT 'new';";
  assert.ok(codes(sql, { postgresMajor: 10 }).includes('MG002'));
  assert.deepEqual(codes(sql, { postgresMajor: 10, largeTables: ['orders'] }), []);
  assert.ok(codes(sql, { postgresMajor: 10, largeTables: ['users'] }).includes('MG002'));
});
test('PG 14 flags volatile column defaults', () => {
  assert.ok(codes('ALTER TABLE users ADD COLUMN token uuid DEFAULT gen_random_uuid();').includes('MG003'));
});
test('a validated CHECK for this column can precede SET NOT NULL', () => {
  const sql = `ALTER TABLE users ADD CONSTRAINT users_email_nn CHECK (email IS NOT NULL) NOT VALID;
    ALTER TABLE users VALIDATE CONSTRAINT users_email_nn;
    ALTER TABLE users ALTER COLUMN email SET NOT NULL;`;
  assert.ok(!codes(sql).includes('MG004'));
});
test('a validated CHECK for a different column does not mask SET NOT NULL', () => {
  const sql = `ALTER TABLE users ADD CONSTRAINT users_name_nn CHECK (name IS NOT NULL) NOT VALID;
    ALTER TABLE users VALIDATE CONSTRAINT users_name_nn;
    ALTER TABLE users ALTER COLUMN email SET NOT NULL;`;
  assert.ok(codes(sql).includes('MG004'));
});
test('flags SET NOT NULL without a validated check', () => {
  assert.ok(codes('ALTER TABLE users ALTER COLUMN email SET NOT NULL;').includes('MG004'));
});
test('requires concurrent index creation and removal', () => {
  assert.deepEqual(codes('CREATE INDEX ix_users_email ON users(email); DROP INDEX ix_users_email;'), ['MG005', 'MG006']);
});
test('foreign keys and checks should be added NOT VALID', () => {
  const sql = 'ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id); ALTER TABLE users ADD CHECK (active);';
  assert.deepEqual(codes(sql), ['MG007', 'MG008']);
});
test('flags type changes and primary key additions', () => {
  const sql = 'ALTER TABLE users ALTER COLUMN id TYPE bigint; ALTER TABLE users ADD PRIMARY KEY (id);';
  assert.deepEqual(codes(sql), ['MG009', 'MG010']);
});
test('flags destructive compatibility changes', () => {
  const sql = 'ALTER TABLE users DROP COLUMN old_email; ALTER TABLE users RENAME COLUMN name TO full_name; DROP TABLE legacy;';
  assert.deepEqual(codes(sql), ['MG011', 'MG012', 'MG013']);
});
test('does not flag a safe concurrent index', () => {
  assert.deepEqual(codes('CREATE INDEX CONCURRENTLY ix_users_email ON users(email);'), []);
});

test('ADD CONSTRAINT is not mistaken for ADD COLUMN', () => {
  const findings = analyze('ALTER TABLE users ADD CONSTRAINT email_nn CHECK (email IS NOT NULL);');
  assert.ok(findings.some(f => f.rule === 'MG008'));
  assert.ok(!findings.some(f => ['MG001', 'MG002', 'MG003'].includes(f.rule)));
});

test('supports ADD COLUMN IF NOT EXISTS', () => {
  assert.ok(codes('ALTER TABLE users ADD COLUMN IF NOT EXISTS email text NOT NULL;').includes('MG001'));
});

test('preserves schema-qualified table names in finding details', () => {
  const [finding] = analyze('ALTER TABLE public.users ADD COLUMN email text NOT NULL;');
  assert.equal(finding.detail, 'public.users.email');
  assert.deepEqual(codes("ALTER TABLE public.users ADD COLUMN status text DEFAULT 'new';", { postgresMajor: 10, largeTables: ['users'] }), ['MG002']);
});

test('flags TRUNCATE as a destructive data operation', () => {
  assert.ok(codes('TRUNCATE TABLE users;').includes('MG014'));
  assert.ok(codes('TRUNCATE users;').includes('MG014'));
});

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('--version prints package.json version without scanning migrations', () => {
  const result = spawnSync(process.execPath, [new URL('../src/cli.js', import.meta.url).pathname, '--version'], { encoding: 'utf8' });
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), pkg.version);
});

test('summarizes findings by rule for structured output', async () => {
  const { summarizeFindings } = await import('../src/summary.js');
  const summary = summarizeFindings([{ rule: 'MG001' }, { rule: 'MG001' }, { rule: 'MG005' }], ruleCatalog);
  assert.equal(summary.total, 3);
  assert.equal(summary.byRule.MG001, 2);
  assert.equal(summary.byRule.MG005, 1);
  assert.equal(summary.byRule.MG013, 0);
});

test('renders GitHub Actions annotations with escaped metadata', async () => {
  const { renderAnnotation } = await import('../src/github.js');
  const result = renderAnnotation({ file: 'db/a:b,c.sql', line: 7, rule: 'MG001', title: 'Unsafe DDL', detail: 'x:y,z' });
  assert.equal(result, '::error file=db/a%3Ab%2Cc.sql,line=7::MG001 Unsafe DDL — x:y,z');
});
