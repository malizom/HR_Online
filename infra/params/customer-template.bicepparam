using '../main.bicep'

// Template for deploying into a customer's own Azure subscription (doc 01 §10).
// Copy to <customer>.bicepparam, set env, and add a GitHub environment `customer-<name>` with its OIDC identity.
param env = 'customer'
param pgSkuName = 'Standard_D2ds_v5'
param pgSkuTier = 'GeneralPurpose'
param pgStorageGb = 64
param pgHighAvailability = true
param pgGeoBackup = true
param pgBackupRetentionDays = 35
param webMinReplicas = 1
param storageSku = 'Standard_ZRS'
param logRetentionDays = 90
param lockDownData = true
