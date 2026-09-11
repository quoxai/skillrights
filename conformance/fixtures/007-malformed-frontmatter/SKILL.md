---
name: unterminated-block
description: The frontmatter block never closes.
license: LicenseRef-SkillRights-NoTrain-1.0

# unterminated-block

Body text. The file opens with a leading "---" line but there is no
matching closing "---" delimiter anywhere below it, so nothing after the
first line can be parsed as frontmatter. Per splitFrontmatter(), this is
treated identically to having no frontmatter block at all.
