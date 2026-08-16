-- Existing attachments were Derek's (SQLite import / pre-multi-user).
UPDATE "Attachment" AS a
SET "uploadedByUserId" = u.id
FROM "User" u
WHERE a."uploadedByUserId" IS NULL
  AND u.role = 'owner';
