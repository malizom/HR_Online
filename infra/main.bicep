// People portal — one environment in one resource group (design doc 01 §5, §10).
// The same template deploys Mvula's staging/production and, unchanged, a customer's own subscription.
// Prerequisites per environment (docs/runbooks/bootstrap-environment.md): resource group, GitHub OIDC identity,
// Key Vault secrets `auth-secret` and `data-encryption-key` created after first deploy.

targetScope = 'resourceGroup'

@description('Environment name, e.g. staging, prod, mvr')
param env string
param location string = 'southafricanorth'
@description('Short prefix for resource names (product name once D16 is decided)')
param prefix string = 'pp'
@description('Container image (set by the deploy workflow)')
param image string = 'mcr.microsoft.com/k8se/quickstart:latest'

// Sizing (doc 01 §5 table)
param pgSkuName string = 'Standard_B1ms'
param pgSkuTier string = 'Burstable'
param pgStorageGb int = 32
param pgHighAvailability bool = false
param pgGeoBackup bool = false
param pgBackupRetentionDays int = 7
param webMinReplicas int = 0
param webMaxReplicas int = 3
param storageSku string = 'Standard_LRS'
param logRetentionDays int = 30
@description('Disable public network access on data services (production)')
param lockDownData bool = false
@description('False on the very first run: creates Key Vault etc. so auth-secret and data-encryption-key can be added before apps start')
param deployApps bool = true
@description('Daily jobs schedule (UTC cron). 0 0 * * * = 02:00 SAST')
param jobsCron string = '0 0 * * *'

@description('Demo tenants (slugs) that get persona sign-in and are seeded with demo data. Empty in production.')
param demoFirms string = ''
@description('Extra hosts for the demo tenant, e.g. demo.people.mvulatelecoms.com. The Azure default host is always added.')
param demoHosts string = ''
@secure()
@description('Access code for demo persona sign-in. Passed from the GitHub secret DEMO_ACCESS_CODE.')
param demoAccessCode string = ''

var n = '${prefix}-${env}'
var nFlat = toLower(replace('${prefix}${env}', '-', ''))
var uniq = substring(uniqueString(resourceGroup().id), 0, 6)
var tags = { product: 'people-portal', environment: env }

// ---------------------------------------------------------------- identities
resource appId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${n}-id-app'
  location: location
  tags: tags
}
resource migrateId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${n}-id-migrate'
  location: location
  tags: tags
}

// ---------------------------------------------------------------- network
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${n}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [{ name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: '10.40.2.0/27'
          delegations: [{ name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
      {
        name: 'endpoints'
        properties: { addressPrefix: '10.40.3.0/27' }
      }
    ]
  }
}
var appsSubnetId = vnet.properties.subnets[0].id
var pgSubnetId = vnet.properties.subnets[1].id
var peSubnetId = vnet.properties.subnets[2].id

resource pgDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${n}-${uniq}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}
resource pgDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: pgDns
  name: 'vnet'
  location: 'global'
  properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
}
resource blobDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}
resource blobDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: blobDns
  name: 'vnet'
  location: 'global'
  properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
}
resource kvDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}
resource kvDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: kvDns
  name: 'vnet'
  location: 'global'
  properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
}

// ---------------------------------------------------------------- observability
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${n}-logs'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: logRetentionDays }
}
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${n}-ai'
  location: location
  kind: 'web'
  tags: tags
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

// ---------------------------------------------------------------- registry
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${nFlat}acr${uniq}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

// ---------------------------------------------------------------- key vault
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${n}-kv-${uniq}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: lockDownData ? 'Disabled' : 'Enabled'
  }
}
resource kvPe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${n}-kv-pe'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnetId }
    privateLinkServiceConnections: [{ name: 'kv', properties: { privateLinkServiceId: kv.id, groupIds: ['vault'] } }]
  }
}
resource kvPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: kvPe
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'kv', properties: { privateDnsZoneId: kvDns.id } }] }
}

// ---------------------------------------------------------------- storage (documents; one container per firm, created by the app)
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${nFlat}docs${uniq}'
  location: location
  tags: tags
  sku: { name: storageSku }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: lockDownData ? 'Disabled' : 'Enabled'
  }
}
resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
  }
}
resource blobPe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${n}-blob-pe'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnetId }
    privateLinkServiceConnections: [{ name: 'blob', properties: { privateLinkServiceId: storage.id, groupIds: ['blob'] } }]
  }
}
resource blobPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: blobPe
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'blob', properties: { privateDnsZoneId: blobDns.id } }] }
}

// ---------------------------------------------------------------- postgres (Entra auth only, VNet-injected)
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${n}-pg-${uniq}'
  location: location
  tags: tags
  sku: { name: pgSkuName, tier: pgSkuTier }
  properties: {
    version: '16'
    storage: { storageSizeGB: pgStorageGb, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: pgBackupRetentionDays, geoRedundantBackup: pgGeoBackup ? 'Enabled' : 'Disabled' }
    highAvailability: { mode: pgHighAvailability ? 'ZoneRedundant' : 'Disabled' }
    network: { delegatedSubnetResourceId: pgSubnetId, privateDnsZoneArmResourceId: pgDns.id, publicNetworkAccess: 'Disabled' }
    authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Disabled', tenantId: subscription().tenantId }
  }
  dependsOn: [pgDnsLink]
}
resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'people'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: 'PGCRYPTO,PG_TRGM', source: 'user-override' }
}
// The migration identity is the Entra admin (owns the schema); the app identity is granted pp_app by scripts/migrate.ts.
module pgAdmin 'modules/pg-admin.bicep' = {
  name: 'pg-admin'
  params: { serverName: pg.name, principalId: migrateId.properties.principalId, principalName: migrateId.name }
  dependsOn: [pgDb, pgExtensions]
}

// ---------------------------------------------------------------- role assignments (least privilege)
var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  blobContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}
resource raAcrApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, appId.id, roles.acrPull)
  scope: acr
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull), principalId: appId.properties.principalId, principalType: 'ServicePrincipal' }
}
resource raAcrMigrate 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, migrateId.id, roles.acrPull)
  scope: acr
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull), principalId: migrateId.properties.principalId, principalType: 'ServicePrincipal' }
}
resource raKvApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, appId.id, roles.kvSecretsUser)
  scope: kv
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser), principalId: appId.properties.principalId, principalType: 'ServicePrincipal' }
}
resource raBlobApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, appId.id, roles.blobContributor)
  scope: storage
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobContributor), principalId: appId.properties.principalId, principalType: 'ServicePrincipal' }
}

// ---------------------------------------------------------------- container apps
resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${n}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
    vnetConfiguration: { infrastructureSubnetId: appsSubnetId, internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    zoneRedundant: false
  }
}

var pgHost = pg.properties.fullyQualifiedDomainName
var commonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PG_ENTRA_AUTH', value: 'true' }
  { name: 'PG_SSL', value: 'true' }
  { name: 'KEY_VAULT_URL', value: kv.properties.vaultUri }
  { name: 'STORAGE_DRIVER', value: 'azure' }
  { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
  { name: 'AUTH_TRUST_HOST', value: 'true' }
]
var appEnv = concat(commonEnv, [
  { name: 'AZURE_CLIENT_ID', value: appId.properties.clientId }
  { name: 'DATABASE_URL', value: 'postgresql://${appId.name}@${pgHost}:5432/people?sslmode=require' }
  { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
  { name: 'DATA_ENCRYPTION_KEY', secretRef: 'data-encryption-key' }
])
var demoEnv = empty(demoFirms) ? [] : concat([{ name: 'DEMO_FIRMS', value: demoFirms }], empty(demoAccessCode) ? [] : [{ name: 'DEMO_ACCESS_CODE', secretRef: 'demo-access-code' }])
var demoSecrets = empty(demoFirms) || empty(demoAccessCode) ? [] : [{ name: 'demo-access-code', value: demoAccessCode }]
var webHost = '${prefix}-web.${caEnv.properties.defaultDomain}'
var appSecrets = [
  { name: 'auth-secret', keyVaultUrl: '${kv.properties.vaultUri}secrets/auth-secret', identity: appId.id }
  { name: 'data-encryption-key', keyVaultUrl: '${kv.properties.vaultUri}secrets/data-encryption-key', identity: appId.id }
]

resource web 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: '${prefix}-web'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appId.id}': {} } }
  properties: {
    environmentId: caEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: acr.properties.loginServer, identity: appId.id }]
      secrets: concat(appSecrets, demoSecrets)
      activeRevisionsMode: 'Single'
    }
    template: {
      containers: [{
        name: 'web'
        image: image
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat(appEnv, demoEnv)
        probes: [
          { type: 'Liveness', httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 30 }
          { type: 'Readiness', httpGet: { path: '/api/ready', port: 3000 }, periodSeconds: 15 }
        ]
      }]
      scale: { minReplicas: webMinReplicas, maxReplicas: webMaxReplicas, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }] }
    }
  }
  dependsOn: [raAcrApp, raKvApp, raBlobApp]
}

resource jobs 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: '${prefix}-jobs'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appId.id}': {} } }
  properties: {
    environmentId: caEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: { cronExpression: jobsCron, parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 1800
      replicaRetryLimit: 1
      registries: [{ server: acr.properties.loginServer, identity: appId.id }]
      secrets: concat(appSecrets, demoSecrets)
    }
    template: {
      containers: [{
        name: 'jobs'
        image: image
        command: ['node', '--import', 'tsx', 'jobs/run.ts']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat(appEnv, demoEnv)
      }]
    }
  }
  dependsOn: [raAcrApp, raKvApp, raBlobApp]
}

resource migrate 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: '${prefix}-migrate'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${migrateId.id}': {} } }
  properties: {
    environmentId: caEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 900
      replicaRetryLimit: 0
      registries: [{ server: acr.properties.loginServer, identity: migrateId.id }]
    }
    template: {
      containers: [{
        name: 'migrate'
        image: image
        command: ['sh', '-c', 'node --import tsx scripts/migrate.ts && node --import tsx db/seed/run.ts']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat(commonEnv, [
          { name: 'AZURE_CLIENT_ID', value: migrateId.properties.clientId }
          { name: 'MIGRATION_DATABASE_URL', value: 'postgresql://${migrateId.name}@${pgHost}:5432/people?sslmode=require' }
          { name: 'APP_DB_PRINCIPAL', value: appId.name }
          { name: 'DATABASE_URL', value: 'postgresql://${migrateId.name}@${pgHost}:5432/people?sslmode=require' }
          { name: 'SEED_DEMO', value: empty(demoFirms) ? 'false' : 'true' }
          { name: 'SEED_DEMO_ACTIVITY', value: 'false' }
          { name: 'DEMO_HOSTS', value: empty(demoHosts) ? webHost : '${webHost},${demoHosts}' }
        ])
      }]
    }
  }
  dependsOn: [raAcrMigrate, pgAdmin]
}

output webFqdn string = deployApps ? web!.properties.configuration.ingress.fqdn : ''
output acrName string = acr.name
output keyVaultName string = kv.name
output postgresHost string = pgHost
output appIdentityClientId string = appId.properties.clientId
