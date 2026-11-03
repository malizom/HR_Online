# Bootstrap an environment (one time per environment)

For staging, production, or a customer subscription (design doc 01 §6, §10). Run by someone with Owner on the subscription.

0. **Register providers** once per subscription: `for p in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Insights Microsoft.Network Microsoft.Storage Microsoft.ManagedIdentity; do az provider register -n $p; done`
1. **Resource group** in South Africa North:
   `az group create -n rg-pp-<env> -l southafricanorth`
2. **Deployment identity for GitHub (OIDC — no secrets in GitHub):**
   ```bash
   az identity create -g rg-pp-<env> -n pp-<env>-id-github
   az role assignment create --assignee-object-id <principalId> --assignee-principal-type ServicePrincipal \
     --role Contributor --scope /subscriptions/<sub>/resourceGroups/rg-pp-<env>
   az role assignment create --assignee-object-id <principalId> --assignee-principal-type ServicePrincipal \
     --role "Role Based Access Control Administrator" --scope /subscriptions/<sub>/resourceGroups/rg-pp-<env>   # template assigns roles
   az identity federated-credential create -g rg-pp-<env> --identity-name pp-<env>-id-github -n github-<env> \
     --issuer https://token.actions.githubusercontent.com \
     --subject repo:<owner>/<repo>:environment:<github-environment> --audiences api://AzureADTokenExchange
   ```
3. **GitHub environment** `<github-environment>` (staging / production / customer-<name>) with variables
   `AZURE_CLIENT_ID` (identity clientId), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`,
   `PARAM_FILE` (e.g. `staging.bicepparam`). Production: add yourself as required reviewer.
4. **First pass — core only:** run the template with `deployApps=false` so Key Vault exists before apps need it:
   `az deployment group create -g rg-pp-<env> --parameters infra/params/<file> --parameters deployApps=false`
5. **Secrets** (from a machine allowed through the Key Vault firewall; in production temporarily allow your IP):
   ```bash
   az role assignment create --assignee <you> --role "Key Vault Secrets Officer" --scope <kv-id>
   az keyvault secret set --vault-name <kv> -n auth-secret --value "$(openssl rand -base64 32)"
   az keyvault secret set --vault-name <kv> -n data-encryption-key --value "$(openssl rand -base64 32)"
   ```
   Store a copy of `data-encryption-key` in Mvula's offline vault — without it, encrypted fields are unrecoverable.
6. **Turn deployment on:** repository variable `DEPLOY_ENABLED=true` (Settings → Secrets and variables → Actions → Variables).
   Then **run the `deploy` workflow** (manual dispatch, choose the environment). It deploys apps, runs migrations
   (which grant the app identity membership of `pp_app`), rolls out and smoke-tests.
7. **Provision the first firm** (see `add-tenant.md`), then add the custom domain (see `custom-domain.md`).
