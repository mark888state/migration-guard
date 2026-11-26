export function isExcluded(relativePath, patterns = []) {
  const file = String(relativePath).replaceAll('\\', '/').replace(/^\.\//, '');
  return patterns.some(pattern => {
    const normalized = String(pattern).trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return normalized && (file === normalized || file.startsWith(normalized + '/'));
  });
}
