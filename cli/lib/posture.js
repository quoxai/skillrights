import { readEmbeddedPosture } from './embedded.js';

export function formatPosture() {
  const data = readEmbeddedPosture();
  const lines = [];
  lines.push('SkillRights posture data: AI provider model-training defaults');
  lines.push('');

  for (const p of data.providers) {
    lines.push(`${p.provider} / ${p.surface}`);
    lines.push(`  Training default: ${p.training_default}`);
    lines.push(`  Toggle:           ${p.toggle}`);
    lines.push(`  Retention:        ${p.retention}`);
    lines.push(`  Verified:         ${p.verified} (${p.method})`);
    if (p.note) lines.push(`  Note:             ${p.note}`);
    lines.push(`  Sources:          ${p.sources.join(', ')}`);
    lines.push('');
  }

  if (Array.isArray(data.legal_context) && data.legal_context.length) {
    lines.push('Legal context');
    for (const item of data.legal_context) {
      lines.push(`  - (verified ${item.verified}) ${item.item}`);
    }
    lines.push('');
  }

  lines.push(`Data bundled ${data.updated}. Always confirm against the linked primary sources.`);
  return lines.join('\n');
}
