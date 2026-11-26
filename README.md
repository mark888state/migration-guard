# migration-guard

[![CI](https://github.com/mark888state/migration-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/mark888state/migration-guard/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/migration-guard)](https://www.npmjs.com/package/migration-guard) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A small, dependency-free CLI and GitHub Action that catches PostgreSQL migration patterns likely to create long locks, table rewrites, or rolling-deploy incompatibilities. It reads SQL files only; it never connects to your database.

**Maintained by @mark888state**

## What it catches

`migration-guard` scans migration SQL before it reaches production. It fails with a non-zero exit code when a configured rule is violated and prints the file, line, reason, and a safer rollout pattern.

The lexer understands quoted strings and identifiers, comments, dollar-quoted bodies, and statement boundaries. The DDL recognizer intentionally covers a focused PostgreSQL subset; it is not a complete PostgreSQL grammar or a substitute for reviewing a migration against your actual schema and workload.

## Installation

```bash
npm install --save-dev migration-guard
npx migration-guard --path ./db/migrations --postgres-major 14
```

Node.js 18 or newer. No runtime dependencies. The package is published to the npm registry from the GitHub release workflow; maintainers must add an `NPM_TOKEN` repository secret with publish permission before running that workflow.

## GitHub Actions

```yaml
name: migration-safety
on: [pull_request]
jobs:
  migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mark888state/migration-guard@v0.1.9
        with:
          path: db/migrations
          postgres-major: '14'
```

The action runs locally from its checked-out action source and does not require an npm install. Pin the action to a reviewed tag or commit SHA in production.

## CLI options

| Option | Default | Description |
| --- | --- | --- |
| `--path` | `migrations` | Recursively scan `.sql` files in this directory |
| `--postgres-major` | `14` | PostgreSQL major version used for default-column checks |
| `--large-tables` | empty | Comma-separated table names to scope the pre-11 default-rewrite rule; empty means all tables |
| `--json` | off | Emit machine-readable findings |
| `--version` | off | Print the installed package version and exit |
| `--github-annotations` | off | Emit inline error annotations in GitHub Actions |
| `--exclude` | empty | Comma-separated relative file paths or directories to skip |

## Rules

| Rule | Pattern | Safer direction |
| --- | --- | --- |
| MG001 | `ADD COLUMN ... NOT NULL` without a default | Add nullable, backfill, then constrain |
| MG002 | `ADD COLUMN ... DEFAULT` on PostgreSQL before 11 for all tables by default, or selected large tables when configured | Avoid rewrite; upgrade or expand/backfill/contract |
| MG003 | `ADD COLUMN` with volatile `DEFAULT` | Backfill in batches and set the default separately |
| MG004 | `SET NOT NULL` without a validated CHECK | Add `CHECK ... NOT VALID`, validate, then set NOT NULL |
| MG005 | `CREATE INDEX` without `CONCURRENTLY` | Create concurrently outside a transaction |
| MG006 | `DROP INDEX` without `CONCURRENTLY` | Drop concurrently outside a transaction |
| MG007 | Foreign key added without `NOT VALID` | Add NOT VALID, then validate separately |
| MG008 | CHECK constraint added without `NOT VALID` | Add NOT VALID, then validate separately |
| MG009 | `ALTER COLUMN ... TYPE` | Use an expand/backfill/contract rollout |
| MG010 | `ADD PRIMARY KEY` | Build a unique index concurrently and attach it |
| MG011 | `DROP COLUMN` | Remove old application references before dropping |
| MG012 | `RENAME COLUMN` | Add/dual-write/backfill/switch/drop |
| MG013 | `DROP TABLE` | Remove only after all application versions stop using it |
| MG014 | `TRUNCATE` | Treat as destructive data removal and review explicitly |
| MG015 | `DROP SCHEMA` | Audit dependent objects before dropping a schema |

Rules are intentionally conservative. Review findings in the context of table size, PostgreSQL version, lock timeout, transaction boundaries, and application deployment strategy.

## Configuration

JSON output includes a total count and per-rule finding counts. The target major version can be set on the command line or via the action input. For PostgreSQL 11+, a constant `ADD COLUMN ... DEFAULT <constant>` is metadata-only; volatile defaults can still require evaluating every row. This checker specifically flags volatile expressions such as `clock_timestamp()`, `random()`, `nextval()`, and `gen_random_uuid()`.

Example JSON output:

```bash
npx migration-guard --path db/migrations --json
```

## Limitations

- This is a lexical DDL guard, not a full PostgreSQL grammar. Unsupported or dynamically generated SQL can evade static checks.
- It cannot infer row counts, indexes, replica lag, lock queues, or concurrent traffic from a SQL file.
- Multi-step safety checks are file-local and conservative; it does not prove that a backfill ran successfully in an earlier deployment.
- `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` cannot run inside a transaction block; migration tools may need per-migration transaction settings.
- A finding is a review gate, not a claim that PostgreSQL will always take a specific lock duration.

## Contributing

Issues and pull requests are welcome. Keep rules deterministic and explain the PostgreSQL behavior they protect against. Add a regression test for every new rule or parser fix.

```bash
git clone https://github.com/mark888state/migration-guard.git
cd migration-guard
npm test
```

Use small focused pull requests. Include the PostgreSQL major versions relevant to a rule and link the upstream PostgreSQL documentation or source behavior in the PR description.

## License

MIT
