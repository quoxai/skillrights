// Minimal, line-based YAML frontmatter handling.
//
// This is deliberately not a full YAML parser: SkillRights only ever needs
// to read or set single flat scalar keys (license, author) at the top level
// of a frontmatter block, while leaving every other line byte-for-byte
// untouched. A general YAML library would risk silently reformatting a
// skill author's file.

function detectNewline(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

// Returns { hasFrontmatter, lines, endIndex, newline } where lines[0] and
// lines[endIndex] are the "---" delimiters. hasFrontmatter is false if the
// file does not open with a "---" line or has no closing delimiter.
export function splitFrontmatter(content) {
  const newline = detectNewline(content);
  const lines = content.split(/\r\n|\n/);
  if (lines[0] !== '---') {
    return { hasFrontmatter: false, lines, newline };
  }
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return { hasFrontmatter: false, lines, newline };
  }
  return { hasFrontmatter: true, lines, endIndex, newline };
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Reads a flat top-level `key: value` scalar from within the frontmatter
// block. Returns null if the key is absent.
export function getField(parsed, key) {
  if (!parsed.hasFrontmatter) return null;
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (let i = 1; i < parsed.endIndex; i++) {
    const match = re.exec(parsed.lines[i]);
    if (match) return unquote(match[1]);
  }
  return null;
}

// Sets (or replaces) a flat top-level `key: value` scalar inside the
// frontmatter block, preserving every other line untouched. Returns the
// full, rejoined file content. Throws if there is no frontmatter block;
// callers should check splitFrontmatter().hasFrontmatter first and avoid
// editing files that lack one.
export function setField(content, key, value) {
  const parsed = splitFrontmatter(content);
  if (!parsed.hasFrontmatter) {
    throw new Error('No YAML frontmatter block found; refusing to edit.');
  }
  const { lines, endIndex, newline } = parsed;
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  let found = false;
  const next = lines.slice();
  for (let i = 1; i < endIndex; i++) {
    if (re.test(next[i])) {
      next[i] = `${key}: ${value}`;
      found = true;
      break;
    }
  }
  if (!found) {
    next.splice(endIndex, 0, `${key}: ${value}`);
  }
  return next.join(newline);
}
