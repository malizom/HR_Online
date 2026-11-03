# Custom domain for a firm

1. Firm creates `CNAME people.<firm-domain> -> <pp-web FQDN>` and the TXT `asuid.people.<firm-domain>` value shown by:
   `az containerapp show -g <rg> -n pp-web --query properties.customDomainVerificationId -o tsv`
2. `az containerapp hostname add -g <rg> -n pp-web --hostname people.<firm-domain>`
   `az containerapp hostname bind -g <rg> -n pp-web --hostname people.<firm-domain> --environment pp-<env>-cae --validation-method CNAME`
3. Add the host to the firm: `insert into firm_domains (firm_id, host, is_primary, verified_at) values (...)`.
4. Update the firm's Entra app redirect URI to the new host.
