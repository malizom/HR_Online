using '../main.bicep'

param env = 'staging'
param pgSkuName = 'Standard_B1ms'
param pgSkuTier = 'Burstable'
param pgStorageGb = 32
param pgHighAvailability = false
param pgGeoBackup = false
param pgBackupRetentionDays = 7
param webMinReplicas = 0
param storageSku = 'Standard_LRS'
param logRetentionDays = 30
param lockDownData = false

// Hosted demo for prospects (MVR first): persona sign-in behind an access code, demo data seeded on first deploy.
param demoFirms = 'demo'
param demoHosts = 'demo.people.mvulatelecoms.com'
