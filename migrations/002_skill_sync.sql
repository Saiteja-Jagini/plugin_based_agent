CREATE TABLE IF NOT EXISTS skill_syncs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  principal_id TEXT NOT NULL REFERENCES principals(id),
  repository_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  resolutions TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, principal_id, repository_id)
);
