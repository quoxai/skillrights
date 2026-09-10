import path from 'node:path';
import { readFileIfExists } from './fsutil.js';
import { splitFrontmatter, getField } from './frontmatter.js';

export function skillMdPath(dir) {
  return path.join(dir, 'SKILL.md');
}

export function readSkillFrontmatter(dir) {
  const content = readFileIfExists(skillMdPath(dir));
  if (content === null) return { exists: false, hasFrontmatter: false };
  const parsed = splitFrontmatter(content);
  return {
    exists: true,
    hasFrontmatter: parsed.hasFrontmatter,
    content,
    parsed,
    license: parsed.hasFrontmatter ? getField(parsed, 'license') : null,
    author: parsed.hasFrontmatter ? getField(parsed, 'author') : null,
  };
}
