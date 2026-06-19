-- Cleanup script: delete session rows that have zero messages.
-- Safe: sessions table is only referenced by messages (FK), so no cascading side effects.
-- Run against the production/local-prod database after verifying counts.

-- Preview (count only):
SELECT count(*) AS empty_sessions
FROM sessions s
WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id);

-- Actual cleanup (uncomment to run):
-- DELETE FROM sessions s
-- WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id);
