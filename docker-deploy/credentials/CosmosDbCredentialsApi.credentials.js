"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmosDbCredentialsApi = void 0;
const crypto_1 = require("crypto");
class CosmosDbCredentialsApi {
    constructor() {
        this.name = 'cosmosDbApi';
        this.displayName = 'Cosmos DB API';
        this.documentationUrl = 'https://docs.microsoft.com/en-us/azure/cosmos-db/';
        this.properties = [
            {
                displayName: 'Endpoint',
                name: 'endpoint',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'https://your-account.documents.azure.com:443/',
                description: 'The Cosmos DB account endpoint URL',
            },
            {
                displayName: 'Access Key',
                name: 'key',
                type: 'string',
                typeOptions: {
                    password: true,
                },
                default: '',
                required: true,
                description: 'The primary or secondary key for your Cosmos DB account',
            },
        ];
        this.test = {
            request: {
                baseURL: '={{$credentials.endpoint}}',
                url: '/dbs',
                method: 'GET',
            },
        };
    }
    async authenticate(credentials, requestOptions) {
        const verb = (requestOptions.method || 'GET').toUpperCase();
        const resourceType = 'dbs';
        const resourceId = '';
        const date = new Date().toUTCString();
        const key = credentials.key;
        const text = `${verb.toLowerCase()}\n${resourceType.toLowerCase()}\n${resourceId}\n${date.toLowerCase()}\n\n`;
        const signature = (0, crypto_1.createHmac)('sha256', Buffer.from(key, 'base64'))
            .update(text)
            .digest('base64');
        const authToken = `type=master&ver=1.0&sig=${signature}`;
        requestOptions.headers = {
            ...requestOptions.headers,
            Authorization: authToken,
            'x-ms-date': date,
            'x-ms-version': '2018-12-31',
        };
        return requestOptions;
    }
}
exports.CosmosDbCredentialsApi = CosmosDbCredentialsApi;
//# sourceMappingURL=CosmosDbCredentialsApi.credentials.js.map