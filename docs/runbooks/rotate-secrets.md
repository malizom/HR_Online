# Rotate secrets

- **Firm Entra secret** (alert fires 30 days before `firms.entra_secret_expires_on`): firm issues a new secret →
  `az keyvault secret set ... -n firm-<slug>-entra-secret` → update `entra_secret_expires_on`. Picked up within 5 minutes (cache TTL).
- **auth-secret**: set a new version in Key Vault, restart `pp-web` revision. All users must sign in again.
- **data-encryption-key**: never rotate in place. Rotation = new key version + re-encryption job (planned for R2,
  `person_sensitive.key_version`). Until then, treat as long-lived and keep the offline copy.
