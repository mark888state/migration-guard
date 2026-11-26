export function summarizeFindings(findings, ruleCatalog) {
  const byRule = Object.fromEntries(ruleCatalog.map(({ code }) => [code, 0]));
  for (const finding of findings) byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
  return { total: findings.length, byRule };
}
