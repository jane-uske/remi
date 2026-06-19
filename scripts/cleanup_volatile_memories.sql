-- Cleanup script: delete volatile facts that leaked into the memories table.
-- These are ephemeral values (当前时间, 现在XX, etc.) that should never have been persisted.

-- Preview (show what will be deleted):
SELECT id, user_id, key, left(value, 60) AS value, importance
FROM memories
WHERE key ~ '^(当前|此刻|目前|现在|刚才|刚刚|今天|今日|昨日|昨天|明日|明天|本次|此次)';

-- Preview: duplicate-ish mode/preference facts (manual review recommended):
SELECT id, user_id, key, left(value, 60) AS value
FROM memories
WHERE key IN ('模式设置', '偏好模式')
ORDER BY user_id, key;

-- Actual cleanup — volatile keys (uncomment to run):
-- DELETE FROM memories
-- WHERE key ~ '^(当前|此刻|目前|现在|刚才|刚刚|今天|今日|昨日|昨天|明日|明天|本次|此次)';

-- Merge duplicate mode/preference facts — keep '偏好模式', delete '模式设置' (uncomment):
-- DELETE FROM memories WHERE key = '模式设置';
