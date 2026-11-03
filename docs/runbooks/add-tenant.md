# Add a tenant (firm)

1. The firm registers an Entra app in **their** Microsoft 365 tenant (single-tenant, Web redirect
   `https://<their-host>/api/auth/callback/microsoft-entra-id`; delegated `openid profile email User.Read`;
   application `Mail.Send` restricted to their no-reply mailbox with an Exchange application access policy).
   They send: tenant id, client id, client secret (by secure channel), secret expiry, no-reply mailbox.
2. Store the secret: `az keyvault secret set --vault-name <kv> -n firm-<slug>-entra-secret --value <secret>`.
3. Provision (run the migrate job image with a command override, or from a jump host on the VNet):
   `npm run db:seed -- --firm <slug> --name "<Display Name>" --legal "<Legal Name>" --host <host> --admin-name "<Name>" --admin-email <email>`
4. Set the firm's Entra and mail settings (operator console in R1 S0+; until then SQL as Entra admin):
   `update firms set entra_tenant_id=..., entra_client_id=..., entra_secret_ref='firm-<slug>-entra-secret', entra_secret_expires_on=..., mail_mode='graph', mail_sender='no-reply@...' where slug='<slug>';`
5. Ask the firm's admin to sign in and check: sign-in works, an email arrives (add a test staff member).
