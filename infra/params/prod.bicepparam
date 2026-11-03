using '../main.bicep'

// Production (doc 01 §5): zone-redundant HA, geo-redundant backups to South Africa West, private data plane.
param env = 'prod'
param pgSkuName = 'Standard_D2ds_v5'
param pgSkuTier = 'GeneralPurpose'
param pgStorageGb = 128
param pgHighAvailability = true
param pgGeoBackup = true
param pgBackupRetentionDays = 35
param webMinReplicas = 1
param storageSku = 'Standard_ZRS'
param logRetentionDays = 90
param lockDownData = true
