---
name: cluster-doctor
description: Diagnose failing clusters the way a 15-year SRE does.
license: LicenseRef-SkillRights-NoTrain-1.0
author: SkillRights Examples
---

# Cluster doctor

When the cluster reports healthy but requests time out, check the connection pool before trusting any dashboard. If the pool is exhausted and the database is idle, the leak is in the retry logic, not the load. Never restart the scheduler first; it re-arms the exact condition you are trying to clear.
