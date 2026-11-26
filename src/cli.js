#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { analyze, ruleCatalog } from './rules.js';

function args(argv) {
  const out = { path: 'migrations', postgresMajor: 14, largeTables: [], json: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help' || key === '-h') out.help = true;
    else if (key === '--version') out.version = true;
    else if (key === '--json') out.json = true;
    else if (key === '--path' && argv[i + 1]) out.path = argv[++i];
    else if (key === '--postgres-major' && argv[i + 1]) out.postgresMajor = Number(argv[++i]);
    else if (key === '--large-tables') out.largeTables = (argv[++i] || '').split(',').map(value => value.trim()).filter(Boolean);
    else throw new Error(`Unknown option or missing value: ${key}`);
  }
  if (!Number.isInteger(out.postgresMajor) || out.postgresMajor < 9) throw new Error('--postgres-major must be an integer >= 9');
  return out;
}
async function sqlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sqlFiles(full) : entry.isFile() && entry.name.endsWith('.sql') ? [full] : [];
  }));
  return files.flat().sort();
}
async function main() {
  const options = args(process.argv.slice(2));
  if (options.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    return;
  }
  if (options.help) {
    console.log('Usage: migration-guard [--path migrations] [--postgres-major 14] [--large-tables users,orders] [--json] [--version]');
    console.log(`Rules: ${ruleCatalog.map(r => r.code).join(', ')}`);
    return;
  }
  const files = await sqlFiles(path.resolve(options.path));
  if (!files.length) { console.error(`No .sql files found under ${options.path}`); process.exitCode = 2; return; }
  const findings = [];
  for (const file of files) {
    const sql = await readFile(file, 'utf8');
    findings.push(...analyze(sql, path.relative(process.cwd(), file), options));
  }
  if (options.json) console.log(JSON.stringify({ files: files.length, findings }, null, 2));
  else if (!findings.length) console.log(`migration-guard: ${files.length} SQL file(s), no unsafe patterns found.`);
  else {
    for (const f of findings) {
      console.error(`✖ ${f.file}:${f.line} ${f.rule} ${f.title}`);
      if (f.detail) console.error(`  ${f.detail}`);
      console.error(`  Fix: ${f.fix}`);
    }
    console.error(`migration-guard: ${findings.length} finding(s) in ${files.length} file(s).`);
    process.exitCode = 1;
  }
}
main().catch(error => { console.error(`migration-guard: ${error.message}`); process.exitCode = 2; });
