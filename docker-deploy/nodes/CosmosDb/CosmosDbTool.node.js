"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmosDbTool = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const cosmos_1 = require("@azure/cosmos");
class N8nCosmosTokenCredential {
    constructor(accessToken, expiresAt) {
        this.accessToken = accessToken;
        this.expiresAt = expiresAt;
        this.accessToken = accessToken.replace(/^Bearer\s+/i, '');
    }
    async getToken() {
        return {
            token: this.accessToken,
            expiresOnTimestamp: this.expiresAt
                ? new Date(this.expiresAt).getTime()
                : Date.now() + 3600 * 1000,
        };
    }
}
function decodeJwtClaims(token) {
    if (!token) {
        return {};
    }
    const tokenParts = token.split('.');
    if (tokenParts.length < 2 || !tokenParts[1]) {
        return {};
    }
    try {
        const normalizedPayload = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
        const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
        const payload = Buffer.from(paddedPayload, 'base64').toString('utf8');
        const parsedPayload = JSON.parse(payload);
        return typeof parsedPayload === 'object' && parsedPayload !== null ? parsedPayload : {};
    }
    catch {
        return {};
    }
}
function extractPreferredUserScopedName(oauthTokenData) {
    if (!oauthTokenData) {
        return undefined;
    }
    const directCandidate = [
        oauthTokenData.unique_name,
        oauthTokenData.preferred_username,
        oauthTokenData.email,
        oauthTokenData.upn,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);
    const tokenClaims = [
        decodeJwtClaims(oauthTokenData.id_token),
        decodeJwtClaims(oauthTokenData.access_token),
    ];
    const tokenCandidate = tokenClaims
        .map((claims) => [claims.unique_name, claims.preferred_username, claims.email, claims.upn].find((value) => typeof value === 'string' && value.trim().length > 0))
        .find((value) => Boolean(value));
    const preferredIdentity = directCandidate !== null && directCandidate !== void 0 ? directCandidate : tokenCandidate;
    if (!preferredIdentity) {
        return undefined;
    }
    const normalizedIdentity = preferredIdentity.trim().toLowerCase();
    if (!normalizedIdentity) {
        return undefined;
    }
    return normalizedIdentity;
}
function prioritizeMatchingOption(options, preferredValue, label = 'Suggested') {
    if (!preferredValue) {
        return options;
    }
    const preferredIndex = options.findIndex((option) => typeof option.value === 'string' &&
        option.value.toLowerCase() === preferredValue.toLowerCase());
    if (preferredIndex <= 0) {
        if (preferredIndex === 0) {
            return [
                {
                    ...options[0],
                    name: `${options[0].name} (${label})`,
                },
                ...options.slice(1),
            ];
        }
        return options;
    }
    const preferredOption = options[preferredIndex];
    return [
        {
            ...preferredOption,
            name: `${preferredOption.name} (${label})`,
        },
        ...options.slice(0, preferredIndex),
        ...options.slice(preferredIndex + 1),
    ];
}
function getValueByPath(source, path) {
    if (!path) {
        return source;
    }
    return path.split('.').reduce((current, segment) => {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (Array.isArray(current)) {
            const index = Number(segment);
            return Number.isInteger(index) ? current[index] : undefined;
        }
        if (typeof current === 'object') {
            return current[segment];
        }
        return undefined;
    }, source);
}
function valueToRerankText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}
async function rerankDocuments(documents, reranker, query, preferredTextPath = '') {
    if (!reranker || documents.length === 0 || !query.trim()) {
        return documents;
    }
    const rerankInput = documents.map((document, index) => {
        const preferredValue = preferredTextPath
            ? getValueByPath(document, preferredTextPath)
            : undefined;
        return {
            pageContent: valueToRerankText(preferredValue !== null && preferredValue !== void 0 ? preferredValue : document),
            metadata: { documentIndex: index },
        };
    });
    const reranked = await reranker.compressDocuments(rerankInput, query);
    const orderedDocuments = [];
    const usedIndexes = new Set();
    for (const document of reranked) {
        const indexValue = Number(document.metadata.documentIndex);
        if (!Number.isInteger(indexValue) || usedIndexes.has(indexValue)) {
            continue;
        }
        const originalDocument = documents[indexValue];
        if (!originalDocument) {
            continue;
        }
        usedIndexes.add(indexValue);
        orderedDocuments.push(originalDocument);
    }
    for (const [index, document] of documents.entries()) {
        if (!usedIndexes.has(index)) {
            orderedDocuments.push(document);
        }
    }
    return orderedDocuments;
}
class CosmosDbTool {
    constructor() {
        this.description = {
            displayName: 'Cosmos DB Tool',
            name: 'cosmosDbTool',
            icon: { light: 'file:database.svg', dark: 'file:lightDatabase.svg' },
            group: ['transform'],
            version: 1,
            description: 'Cosmos DB retrieval tool for AI Agent workflows',
            defaults: { name: 'Cosmos DB Tool' },
            inputs: `={{
			((parameters) => {
				if (parameters?.operation === 'hybridSearch') {
					return [
						{ displayName: 'Embeddings', type: '${n8n_workflow_1.NodeConnectionTypes.AiEmbedding}', required: true, maxConnections: 1 },
						{ displayName: 'Reranker', type: '${n8n_workflow_1.NodeConnectionTypes.AiReranker}', required: false, maxConnections: 1 }
					];
				}
				return [];
			})($parameter)
		}}`,
            outputs: [n8n_workflow_1.NodeConnectionTypes.AiTool],
            credentials: [
                {
                    name: 'cosmosDbApi',
                    required: true,
                    displayOptions: {
                        show: {
                            authenticationType: ['masterKey'],
                        },
                    },
                },
                {
                    name: 'cosmosDbEntraIdApi',
                    required: true,
                    displayOptions: {
                        show: {
                            authenticationType: ['entraId'],
                        },
                    },
                },
            ],
            properties: [
                {
                    displayName: 'Authentication Type',
                    name: 'authenticationType',
                    type: 'options',
                    options: [
                        { name: 'Master Key', value: 'masterKey' },
                        { name: 'Microsoft Entra ID (Azure AD)', value: 'entraId' },
                    ],
                    default: 'masterKey',
                    description: 'The authentication method to use for connecting to Cosmos DB',
                },
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    options: [
                        { name: 'Select', value: 'select', action: 'Select documents' },
                        { name: 'Hybrid Search', value: 'hybridSearch', action: 'Hybrid search documents' },
                    ],
                    default: 'select',
                    noDataExpression: true,
                },
                {
                    displayName: 'Tool Description',
                    name: 'descriptionType',
                    type: 'options',
                    options: [
                        {
                            name: 'Automatically From Node Configuration',
                            value: 'auto',
                        },
                        {
                            name: 'Define Below',
                            value: 'manual',
                        },
                    ],
                    default: 'auto',
                    description: 'Whether to let n8n generate the tool description or define it manually',
                },
                {
                    displayName: 'Tool Description',
                    name: 'toolDescription',
                    type: 'string',
                    typeOptions: { rows: 3 },
                    default: '',
                    placeholder: 'Describe when the AI agent should use this tool and what inputs it expects',
                    description: 'Custom description shown to the AI agent for tool selection and invocation',
                    hint: 'Use this when the automatic description is not specific enough for the agent',
                    displayOptions: {
                        show: {
                            descriptionType: ['manual'],
                        },
                    },
                },
                {
                    displayName: 'Database Name or ID',
                    name: 'databaseName',
                    type: 'options',
                    typeOptions: {
                        loadOptionsDependsOn: [
                            'authenticationType',
                            'useDevOverride',
                            'customEndpoint',
                            'customAccessToken',
                        ],
                        loadOptionsMethod: 'getDatabases',
                    },
                    default: '',
                    placeholder: 'Select a database...',
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    hint: 'This field supports expressions if you need to inject the database ID dynamically.',
                },
                {
                    displayName: 'Container Name or ID',
                    name: 'containerName',
                    type: 'options',
                    typeOptions: {
                        loadOptionsDependsOn: [
                            'databaseName',
                            'authenticationType',
                            'useDevOverride',
                            'customEndpoint',
                            'customAccessToken',
                        ],
                        loadOptionsMethod: 'getContainers',
                    },
                    default: '',
                    placeholder: 'Select a container...',
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    hint: 'This field supports expressions if you need to inject the container ID dynamically.',
                },
                {
                    displayName: 'SQL Query',
                    name: 'sqlQuery',
                    type: 'string',
                    typeOptions: { rows: 5 },
                    default: 'SELECT * FROM c',
                    placeholder: 'SELECT * FROM c WHERE c.status = "active"',
                    description: 'The default SQL query to execute against the container when the tool input does not provide one',
                    hint: 'This value is used as the fallback for structured tool calls',
                    displayOptions: { show: { operation: ['select'] } },
                },
                {
                    displayName: 'Return All',
                    name: 'returnAll',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return all results or only up to a given limit',
                    displayOptions: { show: { operation: ['select'] } },
                },
                {
                    displayName: 'Limit',
                    name: 'limit',
                    type: 'number',
                    default: 50,
                    typeOptions: { minValue: 1 },
                    description: 'Max number of results to return',
                    hint: 'This value is used when the tool input does not provide a limit',
                    displayOptions: { show: { operation: ['select'], returnAll: [false] } },
                },
                {
                    displayName: 'Keyword (Full Text Search)',
                    name: 'keyword',
                    type: 'string',
                    default: '',
                    placeholder: 'azure cosmos db vector search',
                    description: 'Default full-text keywords for hybrid search when the tool input does not provide them',
                    hint: 'Leave empty to rely entirely on the tool call input',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Search Query (Vector Search)',
                    name: 'searchQuery',
                    type: 'string',
                    default: '',
                    placeholder: 'Find papers about retrieval-augmented generation',
                    description: 'Default semantic search query when the tool input does not provide one',
                    hint: 'Leave empty to rely entirely on the tool call input',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Vector Field Name',
                    name: 'hybridVectorFieldName',
                    type: 'string',
                    default: 'vector',
                    placeholder: 'vector',
                    required: true,
                    description: 'The document field used for vector search',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Full Text Field Name',
                    name: 'hybridTextFieldName',
                    type: 'string',
                    default: 'text',
                    placeholder: 'text',
                    required: true,
                    description: 'The document field used for full-text search',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Top K',
                    name: 'topK',
                    type: 'number',
                    default: 10,
                    typeOptions: { minValue: 1, maxValue: 1000 },
                    description: 'Number of top results to retrieve from the database',
                    hint: 'This value is used when the tool input does not provide topK',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Include Debug Info',
                    name: 'includeDebugInfo',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to include embedding, query, and result diagnostics in the tool response',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Partition Key Field',
                    name: 'partitionKeyField',
                    type: 'string',
                    default: 'category',
                    placeholder: 'category',
                    description: 'The partition key field name used for optional filtering',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Partition Key Value',
                    name: 'partitionKeyValue',
                    type: 'string',
                    default: '',
                    placeholder: 'research',
                    description: 'Optional partition key value for filtering',
                    hint: 'Leave empty when you do not need partition filtering.',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Additional SQL Filters',
                    name: 'additionalFilters',
                    type: 'string',
                    default: '',
                    typeOptions: { rows: 3 },
                    placeholder: 'c.published = true AND c.year > 2020',
                    description: 'Optional SQL filters appended to the hybrid search query',
                    hint: 'Use SQL conditions only, without the WHERE keyword.',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Fields to Return',
                    name: 'fieldsToReturn',
                    type: 'string',
                    default: '',
                    placeholder: 'ID, title, summary',
                    description: 'Optional comma-separated list of fields to return instead of the full document',
                    hint: 'Leave empty to return full documents.',
                    displayOptions: { show: { operation: ['hybridSearch'] } },
                },
                {
                    displayName: 'Simplify Output',
                    name: 'simplifyOutput',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to remove common Cosmos DB metadata fields from the output',
                },
                {
                    displayName: 'Exclude Fields',
                    name: 'excludeFields',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to exclude additional specific fields from the output',
                },
                {
                    displayName: 'Fields to Exclude',
                    name: 'fieldsToExclude',
                    type: 'string',
                    default: 'vector,text',
                    placeholder: 'vector,text,rawContent',
                    description: 'Comma-separated list of fields to exclude from the output',
                    displayOptions: { show: { excludeFields: [true] } },
                },
                {
                    displayName: 'Use Dev Override (Custom Endpoint + Token)',
                    name: 'useDevOverride',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to override the selected credentials with a custom endpoint and access token',
                },
                {
                    displayName: 'Custom Endpoint',
                    name: 'customEndpoint',
                    type: 'string',
                    default: '',
                    placeholder: 'https://your-account.documents.azure.com:443/',
                    description: 'The Cosmos DB account endpoint URL to use for the dev override',
                    displayOptions: { show: { useDevOverride: [true] } },
                },
                {
                    displayName: 'Custom Access Token',
                    name: 'customAccessToken',
                    type: 'string',
                    typeOptions: { password: true },
                    default: '',
                    description: 'The bearer token to use with the custom endpoint override',
                    displayOptions: { show: { useDevOverride: [true] } },
                },
            ],
        };
        this.methods = {
            loadOptions: {
                async getDatabases() {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    let client;
                    let preferredUserScopedName;
                    const customEndpoint = (this.getNodeParameter('customEndpoint', '') || '').trim();
                    const customAccessToken = (this.getNodeParameter('customAccessToken', '') || '').trim();
                    if (customEndpoint && customAccessToken) {
                        preferredUserScopedName = extractPreferredUserScopedName({
                            access_token: customAccessToken,
                        });
                        client = new cosmos_1.CosmosClient({
                            endpoint: customEndpoint,
                            aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
                        });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const endpoint = creds.endpoint;
                        const oauthTokenData = creds.oauthTokenData;
                        preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
                        client = new cosmos_1.CosmosClient({
                            endpoint,
                            aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
                        });
                    }
                    else {
                        const credentials = await this.getCredentials('cosmosDbApi');
                        client = new cosmos_1.CosmosClient({
                            endpoint: credentials.endpoint,
                            key: credentials.key,
                        });
                    }
                    try {
                        const { resources } = await client.databases.readAll().fetchAll();
                        const options = resources.map((database) => ({
                            name: database.id,
                            value: database.id,
                        }));
                        return prioritizeMatchingOption(options, preferredUserScopedName);
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load databases: ${message}`);
                    }
                },
                async getContainers() {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const databaseName = this.getCurrentNodeParameter('databaseName');
                    let preferredUserScopedName;
                    if (!databaseName) {
                        return [];
                    }
                    let client;
                    const customEndpoint = (this.getNodeParameter('customEndpoint', '') || '').trim();
                    const customAccessToken = (this.getNodeParameter('customAccessToken', '') || '').trim();
                    if (customEndpoint && customAccessToken) {
                        preferredUserScopedName = extractPreferredUserScopedName({
                            access_token: customAccessToken,
                        });
                        client = new cosmos_1.CosmosClient({
                            endpoint: customEndpoint,
                            aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
                        });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const endpoint = creds.endpoint;
                        const oauthTokenData = creds.oauthTokenData;
                        preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
                        client = new cosmos_1.CosmosClient({
                            endpoint,
                            aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
                        });
                    }
                    else {
                        const credentials = await this.getCredentials('cosmosDbApi');
                        client = new cosmos_1.CosmosClient({
                            endpoint: credentials.endpoint,
                            key: credentials.key,
                        });
                    }
                    try {
                        const database = client.database(databaseName);
                        const { resources } = await database.containers.readAll().fetchAll();
                        const options = resources.map((container) => ({
                            name: container.id,
                            value: container.id,
                        }));
                        return prioritizeMatchingOption(options, preferredUserScopedName);
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load containers: ${message}`);
                    }
                },
            },
        };
    }
    async supplyData(itemIndex) {
        const operation = this.getNodeParameter('operation', itemIndex, 'select');
        const authenticationType = this.getNodeParameter('authenticationType', itemIndex, 'masterKey');
        const customEndpoint = this.getNodeParameter('customEndpoint', itemIndex, '').trim();
        const customAccessToken = this.getNodeParameter('customAccessToken', itemIndex, '').trim();
        const databaseName = this.getNodeParameter('databaseName', itemIndex, '').trim();
        const containerName = this.getNodeParameter('containerName', itemIndex, '').trim();
        const simplifyOutput = this.getNodeParameter('simplifyOutput', itemIndex, true);
        const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false);
        const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '');
        if (!databaseName || !containerName) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database Name and Container Name are required.');
        }
        const embeddings = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiEmbedding, 0));
        const reranker = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiReranker, 0));
        if (operation === 'hybridSearch' && !embeddings) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Connect an Embeddings model to use Hybrid Search.');
        }
        let client;
        if (customEndpoint && customAccessToken) {
            client = new cosmos_1.CosmosClient({
                endpoint: customEndpoint,
                aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
            });
        }
        else if (authenticationType === 'entraId') {
            const entraIdCredentials = await this.getCredentials('cosmosDbEntraIdApi');
            const endpoint = entraIdCredentials.endpoint;
            const oauthTokenData = entraIdCredentials.oauthTokenData;
            if (!(oauthTokenData === null || oauthTokenData === void 0 ? void 0 : oauthTokenData.access_token)) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'No valid Entra ID access token found.');
            }
            client = new cosmos_1.CosmosClient({
                endpoint,
                aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
            });
        }
        else {
            const credentials = await this.getCredentials('cosmosDbApi');
            client = new cosmos_1.CosmosClient({
                endpoint: credentials.endpoint,
                key: credentials.key,
            });
        }
        const container = client.database(databaseName).container(containerName);
        const defaultSqlQuery = this.getNodeParameter('sqlQuery', itemIndex, 'SELECT * FROM c');
        const returnAll = this.getNodeParameter('returnAll', itemIndex, true);
        const limit = this.getNodeParameter('limit', itemIndex, 50);
        const defaultKeyword = this.getNodeParameter('keyword', itemIndex, '');
        const defaultSearchQuery = this.getNodeParameter('searchQuery', itemIndex, '');
        const vectorFieldName = this.getNodeParameter('hybridVectorFieldName', itemIndex, 'vector');
        const textFieldName = this.getNodeParameter('hybridTextFieldName', itemIndex, 'text');
        const topK = this.getNodeParameter('topK', itemIndex, 10);
        const includeDebugInfo = this.getNodeParameter('includeDebugInfo', itemIndex, false);
        const partitionKeyField = this.getNodeParameter('partitionKeyField', itemIndex, 'category');
        const partitionKeyValue = this.getNodeParameter('partitionKeyValue', itemIndex, '');
        const additionalFilters = this.getNodeParameter('additionalFilters', itemIndex, '');
        const fieldsToReturn = this.getNodeParameter('fieldsToReturn', itemIndex, '');
        const descriptionType = this.getNodeParameter('descriptionType', itemIndex, 'auto');
        const manualToolDescription = this.getNodeParameter('toolDescription', itemIndex, '');
        const toolDescription = descriptionType === 'manual' && manualToolDescription.trim()
            ? manualToolDescription.trim()
            : operation === 'hybridSearch'
                ? `Search Azure Cosmos DB container "${containerName}" in database "${databaseName}" using hybrid full-text and vector search. ` +
                    `Input MUST be a JSON string with these fields: ` +
                    `"query" (string, required: natural-language phrase used for semantic vector embedding search), ` +
                    `"keyword" (string, required: space-separated words used for full-text RRF ranking), ` +
                    `"topK" (number, optional: max results, default ${topK}). ` +
                    `Example: {"query":"equipment list for imaging lab","keyword":"imaging equipment microscope","topK":5}`
                : `Query Azure Cosmos DB container "${containerName}" in database "${databaseName}" using SQL select. ` +
                    `Input MUST be a JSON string with fields: ` +
                    `"sqlQuery" (string, optional: SQL query, default "SELECT * FROM c"), ` +
                    `"rerankQuery" (string, optional: phrase to rerank results). ` +
                    `Example: {"sqlQuery":"SELECT * FROM c WHERE c.status = 'active'","rerankQuery":"most recent items"}`;
        const executeTool = async (input) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
            try {
                let parsed = {};
                const rawInput = typeof input === 'string' ? input.trim() : '';
                if (typeof input === 'string') {
                    try {
                        parsed = JSON.parse(input);
                    }
                    catch {
                        parsed = operation === 'hybridSearch' ? { query: input } : { sqlQuery: input };
                    }
                }
                else if (input && typeof input === 'object') {
                    parsed = input;
                }
                const stripOutput = (doc) => {
                    let cleaned = doc;
                    if (simplifyOutput) {
                        cleaned = { ...cleaned };
                        for (const field of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
                            delete cleaned[field];
                        }
                    }
                    if (excludeFields && fieldsToExclude) {
                        cleaned = { ...cleaned };
                        for (const field of fieldsToExclude
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean)) {
                            delete cleaned[field];
                        }
                    }
                    return cleaned;
                };
                if (operation === 'hybridSearch') {
                    const requestedKeyword = String((_b = (_a = parsed.keyword) !== null && _a !== void 0 ? _a : defaultKeyword) !== null && _b !== void 0 ? _b : '').trim();
                    const requestedQuery = String((_e = (_d = (_c = parsed.query) !== null && _c !== void 0 ? _c : parsed.searchQuery) !== null && _d !== void 0 ? _d : defaultSearchQuery) !== null && _e !== void 0 ? _e : '').trim();
                    const query = requestedQuery || requestedKeyword || rawInput;
                    const keyword = requestedKeyword || query;
                    const effectiveTopK = Number((_f = parsed.topK) !== null && _f !== void 0 ? _f : topK);
                    const effectivePkValue = String((_h = (_g = parsed.partitionKeyValue) !== null && _g !== void 0 ? _g : partitionKeyValue) !== null && _h !== void 0 ? _h : '').trim();
                    const effectiveFilters = String((_k = (_j = parsed.additionalFilters) !== null && _j !== void 0 ? _j : additionalFilters) !== null && _k !== void 0 ? _k : '').trim();
                    const effectiveFieldsToReturn = String((_m = (_l = parsed.fieldsToReturn) !== null && _l !== void 0 ? _l : fieldsToReturn) !== null && _m !== void 0 ? _m : '').trim();
                    const embedding = await embeddings.embedQuery(query);
                    const embeddingLiteral = `[${embedding.join(',')}]`;
                    const safeKeyword = keyword
                        .replace(/\\/g, '\\\\')
                        .replace(/"/g, '\\"')
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((word) => `'${word}'`)
                        .join(',');
                    const conditions = [];
                    if (effectivePkValue) {
                        conditions.push(`c.${partitionKeyField}='${effectivePkValue.replace(/'/g, "''")}'`);
                    }
                    if (effectiveFilters) {
                        conditions.push(`(${effectiveFilters})`);
                    }
                    let selectClause = '*';
                    if (effectiveFieldsToReturn) {
                        selectClause = effectiveFieldsToReturn
                            .split(',')
                            .map((field) => {
                            const trimmed = field.trim();
                            return trimmed.startsWith('c.') || /\s+AS\s+/i.test(trimmed)
                                ? trimmed
                                : `c.${trimmed}`;
                        })
                            .join(', ');
                    }
                    const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
                    const sql = `SELECT TOP ${effectiveTopK} ${selectClause} FROM c${whereClause} ` +
                        `ORDER BY RANK RRF(FullTextScore(c.${textFieldName}, ${safeKeyword}), ` +
                        `VectorDistance(c.${vectorFieldName}, ${embeddingLiteral}))`;
                    const hybridDebug = {
                        query,
                        keyword,
                        topK: effectiveTopK,
                        partitionKeyValue: effectivePkValue,
                        additionalFilters: effectiveFilters,
                        fieldsToReturn: effectiveFieldsToReturn,
                        embeddingDimensions: embedding.length,
                        sql,
                    };
                    const { resources } = await container.items.query(sql).fetchAll();
                    if (!(resources === null || resources === void 0 ? void 0 : resources.length)) {
                        return JSON.stringify(includeDebugInfo
                            ? {
                                message: 'No results found',
                                operation,
                                query,
                                debug: hybridDebug,
                            }
                            : { message: 'No results found', operation, query });
                    }
                    const reranked = await rerankDocuments(resources, reranker, query, textFieldName);
                    const cleanedResults = reranked.map(stripOutput);
                    return JSON.stringify(includeDebugInfo
                        ? {
                            results: cleanedResults,
                            debug: {
                                ...hybridDebug,
                                resultCount: cleanedResults.length,
                            },
                        }
                        : cleanedResults);
                }
                const sql = String((_p = (_o = parsed.sqlQuery) !== null && _o !== void 0 ? _o : parsed.sql) !== null && _p !== void 0 ? _p : defaultSqlQuery).trim();
                const rerankQuery = String((_r = (_q = parsed.rerankQuery) !== null && _q !== void 0 ? _q : parsed.query) !== null && _r !== void 0 ? _r : '').trim();
                const { resources } = await container.items.query(sql).fetchAll();
                if (!(resources === null || resources === void 0 ? void 0 : resources.length)) {
                    return JSON.stringify({ message: 'No results found', operation });
                }
                const limited = returnAll ? resources : resources.slice(0, limit);
                const reranked = await rerankDocuments(limited, reranker, rerankQuery);
                return JSON.stringify(reranked.map(stripOutput));
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Cosmos DB Tool failed during ${operation}: ${message}`);
            }
        };
        const toolName = (0, n8n_workflow_1.nodeNameToToolName)(this.getNode());
        const { DynamicTool } = require('@langchain/core/tools');
        const tool = new DynamicTool({
            name: toolName,
            description: toolDescription,
            func: async (rawInput) => {
                let parsed = {};
                try {
                    parsed = JSON.parse(rawInput);
                }
                catch {
                    parsed = operation === 'hybridSearch' ? { query: rawInput } : { sqlQuery: rawInput };
                }
                const inputJson = parsed;
                const { index } = this.addInputData(n8n_workflow_1.NodeConnectionTypes.AiTool, [[{ json: inputJson }]]);
                try {
                    const response = await executeTool(parsed);
                    void this.addOutputData(n8n_workflow_1.NodeConnectionTypes.AiTool, index, [[{ json: { response } }]]);
                    return response;
                }
                catch (error) {
                    const executionError = error instanceof n8n_workflow_1.NodeOperationError
                        ? error
                        : new n8n_workflow_1.NodeOperationError(this.getNode(), error);
                    void this.addOutputData(n8n_workflow_1.NodeConnectionTypes.AiTool, index, executionError);
                    throw executionError;
                }
            },
        });
        return { response: tool };
    }
    async execute() {
        throw new Error('Cosmos DB Tool only supports the AI tool bus. Connect it to an AI Agent via the Tool output.');
    }
}
exports.CosmosDbTool = CosmosDbTool;
//# sourceMappingURL=CosmosDbTool.node.js.map