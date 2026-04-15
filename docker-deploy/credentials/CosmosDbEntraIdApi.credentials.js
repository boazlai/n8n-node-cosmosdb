"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmosDbEntraIdApi = void 0;
class CosmosDbEntraIdApi {
    constructor() {
        this.name = 'cosmosDbEntraIdApi';
        this.displayName = 'Cosmos DB (Microsoft Entra ID / Azure AD) API';
        this.documentationUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-setup-rbac';
        this.extends = ['microsoftOAuth2Api'];
        this.properties = [
            {
                displayName: 'OAuth Redirect URL',
                name: 'oauthCallbackUrl',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Authorization URL',
                name: 'authUrl',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Access Token URL',
                name: 'accessTokenUrl',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Client ID',
                name: 'clientId',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Client Secret',
                name: 'clientSecret',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Allowed HTTP Request Domains',
                name: 'allowedDomains',
                type: 'hidden',
                default: 'All',
            },
            {
                displayName: 'Microsoft Graph API Base URL',
                name: 'graphApiBaseUrl',
                type: 'hidden',
                default: 'Global (https://graph.microsoft.com)',
            },
            {
                displayName: 'Scope',
                name: 'scope',
                type: 'hidden',
                default: '={{$self.apiScope.includes("offline_access") ? $self.apiScope : "offline_access " + $self.apiScope}}',
            },
            {
                displayName: 'API Scope',
                name: 'apiScope',
                type: 'hidden',
                required: true,
                default: 'https://cosmos.azure.com/user_impersonation',
            },
            {
                displayName: 'Endpoint',
                name: 'endpoint',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'https://your-account.documents.azure.com:443/',
                description: 'The Cosmos DB account endpoint URL',
                noDataExpression: true,
            },
            {
                displayName: 'Token Refresh Buffer (seconds)',
                name: 'refreshBeforeExpirySeconds',
                type: 'number',
                typeOptions: {
                    minValue: 60,
                    maxValue: 3600,
                },
                default: 900,
                description: 'How many seconds before token expiry to proactively refresh the token. This prevents the token from expiring in the middle of a workflow execution. Default: 900 (15 minutes). Range: 60–3600.',
                placeholder: '900',
                hint: 'Set based on your workflow duration: Long workflows (30–60 min) → 1800–3600, Quick workflows (5–10 min) → 300–600',
                noDataExpression: true,
            },
        ];
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    Authorization: '=type=aad&ver=1.0&sig={{$credentials.oauthTokenData.access_token}}',
                },
            },
        };
    }
}
exports.CosmosDbEntraIdApi = CosmosDbEntraIdApi;
//# sourceMappingURL=CosmosDbEntraIdApi.credentials.js.map