# Sophie Architecture

Sophie uses a controlled self-upgrade pipeline.

User request
-> intent
-> protected upgrade planner
-> inspect relevant source
-> generate complete file contents
-> validate paths and limits
-> backup
-> write atomically
-> syntax-check
-> validate entire src tree
-> optional PM2 restart
-> health check
-> Git checkpoint
-> report result

The AI never receives an arbitrary shell command executor. The upgrade engine
controls what can be written and what fixed operational commands can run.

## Protected endpoints

POST /api/self-upgrade/plan
- Requires SOPHIE_ADMIN_PASSCODE.
- Returns a proposed plan without writing files.

POST /api/self-upgrade/chat
- Requires SOPHIE_ADMIN_PASSCODE.
- Plans and applies the upgrade.
- Supports checkpoint and restart flags.

POST /api/self-upgrade
- Existing low-level structured file-change endpoint.

GET /api/self-upgrade/status
- Validation and Git status.

## Recovery

Every upgrade creates a backup. Syntax failures roll back immediately.
Post-validation, restart, and health failures are designed to restore the
backup before restarting Sophie again.

## Extension points

The same architecture can later host controlled video analysis,
document analysis, scheduled tasks, GitHub workflows, and other tools.
Each tool should expose structured inputs and explicit allowlists rather
than arbitrary shell access.
