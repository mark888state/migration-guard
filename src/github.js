const escapeData = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = value => escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');

export function renderAnnotation(finding) {
  const file = escapeProperty(finding.file);
  const line = String(finding.line);
  const message = finding.rule + ' ' + finding.title + (finding.detail ? ' — ' + finding.detail : '');
  return '::error file=' + file + ',line=' + line + '::' + escapeData(message);
}
