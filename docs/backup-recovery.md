# MySQL backup and isolated recovery

## Storage and security

- Backups are stored by default in `storage/database-backups/`, which is outside all public static directories and ignored by Git.
- The backup scripts never put passwords on the command line or in logs. They create a temporary MySQL defaults file with restrictive permissions and remove it after each run.
- Backup files, manifests, hashes and logs must be kept on encrypted storage with access limited to the system administrator.
- The backup lock prevents overlapping executions. A stale lock must be investigated manually; do not delete it while a backup may still be active.

## Configuration

1. Copy `.env.backup.example` to `.env.backup` locally.
2. Configure a dedicated MySQL backup account with only the documented minimum privileges.
3. Keep `.env.backup` private; it is ignored by Git.
4. Do not set `BACKUP_RETENTION_DELETE_APPROVED=true` until retention deletion has been reviewed and approved.

Production backups include database events by default. The isolated test configuration omits events because its restricted test account does not have `SHOW EVENTS`; the production backup account must have that privilege before production scheduling is approved.

## Manual backup

Test database only:

```powershell
node scripts/mysql-backup.js --config=.env.test --test
```

Production backup, only after explicit approval:

```powershell
node scripts/mysql-backup.js --config=.env.backup --allow-production
```

Each successful backup creates a timestamped `.sql` file and a SHA-256 sidecar file. Verify both before considering a backup usable.

## Isolated recovery test

Never restore over `zoicas_osinski` or `zoicas_osinski_test`.

Create `.env.recovery.test` locally from `.env.recovery.test.example` with an authorized recovery-administrator account. Do not use the application account.

```powershell
node scripts/mysql-restore-isolated.js --config=.env.test --recovery-admin-config=.env.recovery.test --test --source=storage/database-backups/<backup-file>.sql --recovery-database=zoicas_osinski_recovery_YYYYMMDD
```

The recovery database name must start with `zoicas_osinski_recovery_` and must not already exist. The script verifies table count, table names and exact row counts against `zoicas_osinski_test`.

## Scheduling

The scheduler is only prepared. It is not installed automatically.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-daily-backup-schedule.ps1 -Action Show
```

After successful backup/recovery testing and explicit written approval, an administrator may install the daily 02:30 task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-daily-backup-schedule.ps1 -Action Install -ApproveProductionSchedule
```

## Emergency procedure

1. Stop application writes and preserve the incident evidence.
2. Select a backup by timestamp and SHA-256 verification.
3. Restore only into a newly named recovery database.
4. Verify tables, row counts for critical tables and application-level integrity there.
5. Obtain explicit incident approval before any separately planned production recovery.
