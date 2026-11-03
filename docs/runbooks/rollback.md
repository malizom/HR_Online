# Roll back a release

Single-revision mode: the previous image is still in ACR.

1. Find the last good image: `az containerapp revision list -g <rg> -n pp-web --query "[].{rev:name,image:properties.template.containers[0].image,active:properties.active}" -o table`
2. Roll back web and jobs: `az containerapp update -g <rg> -n pp-web --image <good-image>`; same for `pp-jobs` with `az containerapp job update`.
3. If the failed release included a migration that is not backward compatible, run its down-script
   (`db/migrations/down/<n>.sql`, required for every migration from S1 onwards) as the Entra admin, after a
   point-in-time restore decision (see restore-database.md). Migrations are written expand-then-contract so this is rare.
4. Record the incident in the service report.
