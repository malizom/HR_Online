// Entra administrator for PostgreSQL Flexible Server. A module because the resource name must be the
// principal's object id, which is only known at deployment time (BCP120 if set directly in main.bicep).
param serverName string
param principalId string
param principalName string

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: serverName
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: pg
  name: principalId
  properties: { principalName: principalName, principalType: 'ServicePrincipal', tenantId: subscription().tenantId }
}
