# Restore the database to a point in time

1. `az postgres flexible-server restore -g <rg> --name <new-server> --source-server <server> --restore-time "<UTC ISO time>"`
2. Verify row counts on the new server against the incident window (`select count(*)` per key table).
3. Either repoint `DATABASE_URL`/`MIGRATION_DATABASE_URL` (template parameter change + deploy) or copy the affected
   firm's rows back with a firm-filtered dump (same method as tenant export, doc 01 §10).
4. The nightly workflow performs this as a drill monthly; log the result.
