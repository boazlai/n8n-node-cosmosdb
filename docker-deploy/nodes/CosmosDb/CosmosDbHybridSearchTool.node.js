"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmosDbHybridSearchTool = void 0;
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
    if (!token)
        return {};
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1])
        return {};
    try {
        const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const payload = Buffer.from(padded, 'base64').toString('utf8');
        const parsed = JSON.parse(payload);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    }
    catch {
        return {};
    }
}
function extractPreferredUserScopedName(oauthTokenData) {
    var _a;
    if (!oauthTokenData)
        return undefined;
    const directCandidate = [
        oauthTokenData.unique_name,
        oauthTokenData.preferred_username,
        oauthTokenData.email,
        oauthTokenData.upn,
    ].find((v) => typeof v === 'string' && v.trim().length > 0);
    const tokenClaims = [
        decodeJwtClaims(oauthTokenData.id_token),
        decodeJwtClaims(oauthTokenData.access_token),
    ];
    const tokenCandidate = tokenClaims
        .map((claims) => [claims.unique_name, claims.preferred_username, claims.email, claims.upn].find((v) => typeof v === 'string' && v.trim().length > 0))
        .find(Boolean);
    const identity = (_a = (directCandidate !== null && directCandidate !== void 0 ? directCandidate : tokenCandidate)) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase();
    return identity || undefined;
}
function prioritizeMatchingOption(options, preferredValue, label = 'Suggested') {
    if (!preferredValue)
        return options;
    const idx = options.findIndex((o) => typeof o.value === 'string' && o.value.toLowerCase() === preferredValue.toLowerCase());
    if (idx <= 0) {
        if (idx === 0)
            return [{ ...options[0], name: `${options[0].name} (${label})` }, ...options.slice(1)];
        return options;
    }
    const preferred = options[idx];
    return [
        { ...preferred, name: `${preferred.name} (${label})` },
        ...options.slice(0, idx),
        ...options.slice(idx + 1),
    ];
}
function getValueByPath(source, path) {
    if (!path)
        return source;
    return path.split('.').reduce((cur, seg) => {
        if (cur === null || cur === undefined)
            return undefined;
        if (Array.isArray(cur)) {
            const i = Number(seg);
            return Number.isInteger(i) ? cur[i] : undefined;
        }
        if (typeof cur === 'object')
            return cur[seg];
        return undefined;
    }, source);
}
function valueToRerankText(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return JSON.stringify(value);
}
async function rerankDocuments(documents, reranker, query, preferredTextPath = '') {
    if (!reranker || documents.length === 0 || !query.trim())
        return documents;
    const rerankInput = documents.map((doc, i) => {
        const preferred = preferredTextPath ? getValueByPath(doc, preferredTextPath) : undefined;
        return { pageContent: valueToRerankText(preferred !== null && preferred !== void 0 ? preferred : doc), metadata: { documentIndex: i } };
    });
    const reranked = await reranker.compressDocuments(rerankInput, query);
    const ordered = [];
    const used = new Set();
    for (const doc of reranked) {
        const i = Number(doc.metadata.documentIndex);
        if (!Number.isInteger(i) || used.has(i))
            continue;
        const original = documents[i];
        if (!original)
            continue;
        used.add(i);
        ordered.push(original);
    }
    for (const [i, doc] of documents.entries()) {
        if (!used.has(i))
            ordered.push(doc);
    }
    return ordered;
}
class CosmosDbHybridSearchTool {
    constructor() {
        this.description = {
            displayName: 'Cosmos DB Hybrid Search Tool',
            name: 'cosmosDbHybridSearchTool',
            icon: { light: 'file:database.svg', dark: 'file:lightDatabase.svg' },
            group: ['transform'],
            version: 1,
            description: 'Hybrid vector + full-text search on Azure Cosmos DB for AI Agent workflows',
            defaults: { name: 'Cosmos DB Hybrid Search' },
            codex: {
                categories: ['AI'],
                subcategories: {
                    AI: ['Vector Stores', 'Tools', 'Root Nodes'],
                    Tools: ['Other Tools'],
                },
            },
            inputs: [
                {
                    displayName: 'Embeddings',
                    type: n8n_workflow_1.NodeConnectionTypes.AiEmbedding,
                    required: true,
                    maxConnections: 1,
                },
                {
                    displayName: 'Reranker',
                    type: n8n_workflow_1.NodeConnectionTypes.AiReranker,
                    required: false,
                    maxConnections: 1,
                },
            ],
            outputs: [n8n_workflow_1.NodeConnectionTypes.AiTool],
            credentials: [
                {
                    name: 'cosmosDbApi',
                    required: true,
                    displayOptions: { show: { authenticationType: ['masterKey'] } },
                },
                {
                    name: 'cosmosDbEntraIdApi',
                    required: true,
                    displayOptions: { show: { authenticationType: ['entraId'] } },
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
                    displayName: 'Tool Description',
                    name: 'toolDescription',
                    type: 'string',
                    typeOptions: { rows: 3 },
                    default: '',
                    placeholder: 'e.g. Search the research paper database for relevant documents',
                    description: 'Tell the AI agent what this tool is for. If left empty an automatic description is generated.',
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
                },
                {
                    displayName: 'Vector Field Name',
                    name: 'vectorFieldName',
                    type: 'string',
                    default: 'vector',
                    required: true,
                    description: 'The document field that stores the vector embedding',
                },
                {
                    displayName: 'Full Text Field Name',
                    name: 'textFieldName',
                    type: 'string',
                    default: 'text',
                    required: true,
                    description: 'The document field used for full-text RRF scoring',
                },
                {
                    displayName: 'Top K',
                    name: 'topK',
                    type: 'number',
                    default: 10,
                    typeOptions: { minValue: 1, maxValue: 1000 },
                    description: 'Number of top results to retrieve',
                },
                {
                    displayName: 'Options',
                    name: 'options',
                    type: 'collection',
                    placeholder: 'Add Option',
                    default: {},
                    options: [
                        {
                            displayName: 'Partition Key Field',
                            name: 'partitionKeyField',
                            type: 'string',
                            default: 'category',
                            description: 'The partition key field name for optional filtering',
                        },
                        {
                            displayName: 'Partition Key Value',
                            name: 'partitionKeyValue',
                            type: 'string',
                            default: '',
                            description: 'Optional partition key value to filter results',
                        },
                        {
                            displayName: 'Additional SQL Filters',
                            name: 'additionalFilters',
                            type: 'string',
                            default: '',
                            typeOptions: { rows: 2 },
                            placeholder: 'c.published = true AND c.year > 2020',
                            description: 'Optional SQL conditions appended to the query (no WHERE keyword)',
                        },
                        {
                            displayName: 'Fields to Return',
                            name: 'fieldsToReturn',
                            type: 'string',
                            default: '',
                            placeholder: 'id, title, summary',
                            description: 'Comma-separated fields to return. Leave empty to return full documents.',
                        },
                        {
                            displayName: 'Simplify Output',
                            name: 'simplifyOutput',
                            type: 'boolean',
                            default: true,
                            description: 'Whether to strip Cosmos DB internal metadata fields (_rid, _self, etc.)',
                        },
                        {
                            displayName: 'Exclude Fields',
                            name: 'excludeFields',
                            type: 'string',
                            default: 'vector,text',
                            placeholder: 'vector,text,rawContent',
                            description: 'Comma-separated fields to remove from output',
                        },
                        {
                            displayName: 'Include Debug Info',
                            name: 'includeDebugInfo',
                            type: 'boolean',
                            default: false,
                            description: 'Whether to include the generated SQL and embedding diagnostics in the response',
                        },
                        {
                            displayName: 'Use Dev Override (Custom Endpoint + Token)',
                            name: 'useDevOverride',
                            type: 'boolean',
                            default: false,
                            description: 'Whether to override credentials with a custom endpoint and access token',
                        },
                        {
                            displayName: 'Custom Endpoint',
                            name: 'customEndpoint',
                            type: 'string',
                            default: '',
                            placeholder: 'https://your-account.documents.azure.com:443/',
                            description: 'Cosmos DB account endpoint URL for the dev override',
                        },
                        {
                            displayName: 'Custom Access Token',
                            name: 'customAccessToken',
                            type: 'string',
                            typeOptions: { password: true },
                            default: '',
                            description: 'Bearer token to use with the custom endpoint override',
                        },
                    ],
                },
            ],
        };
        this.methods = {
            loadOptions: {
                async getDatabases() {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const options = this.getNodeParameter('options', 0, {});
                    const customEndpoint = (options.customEndpoint || '').trim();
                    const customAccessToken = (options.customAccessToken || '').trim();
                    let client;
                    let preferredUserScopedName;
                    if (customEndpoint && customAccessToken) {
                        preferredUserScopedName = extractPreferredUserScopedName({ access_token: customAccessToken });
                        client = new cosmos_1.CosmosClient({ endpoint: customEndpoint, aadCredentials: new N8nCosmosTokenCredential(customAccessToken) });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const oauthTokenData = creds.oauthTokenData;
                        preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
                        client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at) });
                    }
                    else {
                        const creds = await this.getCredentials('cosmosDbApi');
                        client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, key: creds.key });
                    }
                    try {
                        const { resources } = await client.databases.readAll().fetchAll();
                        const opts = resources.map((db) => ({ name: db.id, value: db.id }));
                        return prioritizeMatchingOption(opts, preferredUserScopedName);
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load databases: ${error.message}`);
                    }
                },
                async getContainers() {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const databaseName = this.getCurrentNodeParameter('databaseName');
                    if (!databaseName)
                        return [];
                    const options = this.getNodeParameter('options', 0, {});
                    const customEndpoint = (options.customEndpoint || '').trim();
                    const customAccessToken = (options.customAccessToken || '').trim();
                    let client;
                    let preferredUserScopedName;
                    if (customEndpoint && customAccessToken) {
                        preferredUserScopedName = extractPreferredUserScopedName({ access_token: customAccessToken });
                        client = new cosmos_1.CosmosClient({ endpoint: customEndpoint, aadCredentials: new N8nCosmosTokenCredential(customAccessToken) });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const oauthTokenData = creds.oauthTokenData;
                        preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
                        client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at) });
                    }
                    else {
                        const creds = await this.getCredentials('cosmosDbApi');
                        client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, key: creds.key });
                    }
                    try {
                        const { resources } = await client.database(databaseName).containers.readAll().fetchAll();
                        const opts = resources.map((c) => ({ name: c.id, value: c.id }));
                        return prioritizeMatchingOption(opts, preferredUserScopedName);
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load containers: ${error.message}`);
                    }
                },
            },
        };
    }
    async supplyData(itemIndex) {
        const authenticationType = this.getNodeParameter('authenticationType', itemIndex, 'masterKey');
        const databaseName = this.getNodeParameter('databaseName', itemIndex, '').trim();
        const containerName = this.getNodeParameter('containerName', itemIndex, '').trim();
        const vectorFieldName = this.getNodeParameter('vectorFieldName', itemIndex, 'vector').trim();
        const textFieldName = this.getNodeParameter('textFieldName', itemIndex, 'text').trim();
        const topK = this.getNodeParameter('topK', itemIndex, 10);
        const manualToolDescription = this.getNodeParameter('toolDescription', itemIndex, '').trim();
        const options = this.getNodeParameter('options', itemIndex, {});
        const partitionKeyField = (options.partitionKeyField || 'category').trim();
        const partitionKeyValue = (options.partitionKeyValue || '').trim();
        const additionalFilters = (options.additionalFilters || '').trim();
        const fieldsToReturn = (options.fieldsToReturn || '').trim();
        const simplifyOutput = options.simplifyOutput !== false;
        const excludeFieldsStr = (options.excludeFields || '').trim();
        const includeDebugInfo = options.includeDebugInfo === true;
        const customEndpoint = (options.customEndpoint || '').trim();
        const customAccessToken = (options.customAccessToken || '').trim();
        if (!databaseName || !containerName) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database Name and Container Name are required.');
        }
        const embeddings = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiEmbedding, 0));
        const reranker = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiReranker, 0));
        if (!embeddings) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Connect an Embeddings model to use Hybrid Search.');
        }
        let client;
        if (customEndpoint && customAccessToken) {
            client = new cosmos_1.CosmosClient({ endpoint: customEndpoint, aadCredentials: new N8nCosmosTokenCredential(customAccessToken) });
        }
        else if (authenticationType === 'entraId') {
            const creds = await this.getCredentials('cosmosDbEntraIdApi');
            const oauthTokenData = creds.oauthTokenData;
            if (!(oauthTokenData === null || oauthTokenData === void 0 ? void 0 : oauthTokenData.access_token)) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'No valid Entra ID access token found.');
            }
            client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at) });
        }
        else {
            const creds = await this.getCredentials('cosmosDbApi');
            client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, key: creds.key });
        }
        const container = client.database(databaseName).container(containerName);
        const toolName = (0, n8n_workflow_1.nodeNameToToolName)(this.getNode());
        const toolDescription = manualToolDescription ||
            `Search Azure Cosmos DB container "${containerName}" in database "${databaseName}" ` +
                `using hybrid full-text and vector search. ` +
                `Input a plain-text query string describing what you want to find. ` +
                `Returns up to ${topK} results ranked by semantic and keyword relevance.`;
        const stripOutput = (doc) => {
            let cleaned = { ...doc };
            if (simplifyOutput) {
                for (const field of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
                    delete cleaned[field];
                }
            }
            if (excludeFieldsStr) {
                for (const field of excludeFieldsStr.split(',').map((f) => f.trim()).filter(Boolean)) {
                    delete cleaned[field];
                }
            }
            return cleaned;
        };
        const context = this;
        const { DynamicStructuredTool } = require('@langchain/core/tools');
        const tool = new DynamicStructuredTool({
            name: toolName,
            description: toolDescription,
            schema: {
                type: 'object',
                properties: {
                    input: {
                        type: 'string',
                        description: 'Plain-text query to search for in the Cosmos DB container',
                    },
                },
                required: ['input'],
            },
            func: async ({ input }) => {
                const { index } = context.addInputData(n8n_workflow_1.NodeConnectionTypes.AiTool, [
                    [{ json: { query: input } }],
                ]);
                try {
                    const embedding = await embeddings.embedQuery(input);
                    const embeddingLiteral = `[${embedding.join(',')}]`;
                    const safeKeyword = input
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((word) => `'${word}'`)
                        .join(',');
                    const conditions = [];
                    if (partitionKeyValue) {
                        conditions.push(`c.${partitionKeyField}='${partitionKeyValue.replace(/'/g, "''")}'`);
                    }
                    if (additionalFilters) {
                        conditions.push(`(${additionalFilters})`);
                    }
                    let selectClause = '*';
                    if (fieldsToReturn) {
                        selectClause = fieldsToReturn
                            .split(',')
                            .map((f) => {
                            const t = f.trim();
                            return t.startsWith('c.') || /\s+AS\s+/i.test(t) ? t : `c.${t}`;
                        })
                            .join(', ');
                    }
                    const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
                    const sql = `SELECT TOP ${topK} ${selectClause} FROM c${whereClause} ` +
                        `ORDER BY RANK RRF(FullTextScore(c.${textFieldName}, ${safeKeyword}), ` +
                        `VectorDistance(c.${vectorFieldName}, ${embeddingLiteral}))`;
                    const { resources } = await container.items.query(sql).fetchAll();
                    if (!(resources === null || resources === void 0 ? void 0 : resources.length)) {
                        const noResult = JSON.stringify(includeDebugInfo
                            ? { message: 'No results found', query: input, sql }
                            : { message: 'No results found', query: input });
                        context.addOutputData(n8n_workflow_1.NodeConnectionTypes.AiTool, index, [[{ json: { response: noResult } }]]);
                        return noResult;
                    }
                    const reranked = await rerankDocuments(resources, reranker, input, textFieldName);
                    const cleaned = reranked.map(stripOutput);
                    const response = JSON.stringify(includeDebugInfo
                        ? { results: cleaned, debug: { query: input, sql, embeddingDimensions: embedding.length, resultCount: cleaned.length } }
                        : cleaned);
                    context.addOutputData(n8n_workflow_1.NodeConnectionTypes.AiTool, index, [[{ json: { response } }]]);
                    return response;
                }
                catch (error) {
                    const message = error.message || String(error);
                    context.addOutputData(n8n_workflow_1.NodeConnectionTypes.AiTool, index, [[{ json: { error: message } }]]);
                    return JSON.stringify({ error: message });
                }
            },
        });
        return { response: tool };
    }
    async execute() {
        var _a, _b;
        const items = this.getInputData();
        const query = (((_b = (_a = items[0]) === null || _a === void 0 ? void 0 : _a.json) === null || _b === void 0 ? void 0 : _b.input) || '').trim();
        if (!query) {
            return [[{ json: { output: 'No query provided' } }]];
        }
        const itemIndex = 0;
        const authenticationType = this.getNodeParameter('authenticationType', itemIndex, 'masterKey');
        const databaseName = this.getNodeParameter('databaseName', itemIndex, '').trim();
        const containerName = this.getNodeParameter('containerName', itemIndex, '').trim();
        const vectorFieldName = this.getNodeParameter('vectorFieldName', itemIndex, 'vector').trim();
        const textFieldName = this.getNodeParameter('textFieldName', itemIndex, 'text').trim();
        const topK = this.getNodeParameter('topK', itemIndex, 10);
        const options = this.getNodeParameter('options', itemIndex, {});
        const partitionKeyField = (options.partitionKeyField || 'category').trim();
        const partitionKeyValue = (options.partitionKeyValue || '').trim();
        const additionalFilters = (options.additionalFilters || '').trim();
        const fieldsToReturn = (options.fieldsToReturn || '').trim();
        const simplifyOutput = options.simplifyOutput !== false;
        const excludeFieldsStr = (options.excludeFields || '').trim();
        const includeDebugInfo = options.includeDebugInfo === true;
        const customEndpoint = (options.customEndpoint || '').trim();
        const customAccessToken = (options.customAccessToken || '').trim();
        if (!databaseName || !containerName) {
            return [[{ json: { output: 'Database Name and Container Name are required.' } }]];
        }
        const embeddings = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiEmbedding, 0));
        if (!embeddings) {
            return [[{ json: { output: 'No Embeddings model connected.' } }]];
        }
        const reranker = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiReranker, 0));
        let client;
        if (customEndpoint && customAccessToken) {
            client = new cosmos_1.CosmosClient({ endpoint: customEndpoint, aadCredentials: new N8nCosmosTokenCredential(customAccessToken) });
        }
        else if (authenticationType === 'entraId') {
            const creds = await this.getCredentials('cosmosDbEntraIdApi');
            const oauthTokenData = creds.oauthTokenData;
            if (!(oauthTokenData === null || oauthTokenData === void 0 ? void 0 : oauthTokenData.access_token)) {
                return [[{ json: { output: 'No valid Entra ID access token found.' } }]];
            }
            client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at) });
        }
        else {
            const creds = await this.getCredentials('cosmosDbApi');
            client = new cosmos_1.CosmosClient({ endpoint: creds.endpoint, key: creds.key });
        }
        const container = client.database(databaseName).container(containerName);
        const stripOutput = (doc) => {
            const cleaned = { ...doc };
            if (simplifyOutput) {
                for (const field of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
                    delete cleaned[field];
                }
            }
            if (excludeFieldsStr) {
                for (const field of excludeFieldsStr.split(',').map((f) => f.trim()).filter(Boolean)) {
                    delete cleaned[field];
                }
            }
            return cleaned;
        };
        try {
            const embedding = await embeddings.embedQuery(query);
            const embeddingLiteral = `[${embedding.join(',')}]`;
            const safeKeyword = query
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map((word) => `'${word}'`)
                .join(',');
            const conditions = [];
            if (partitionKeyValue) {
                conditions.push(`c.${partitionKeyField}='${partitionKeyValue.replace(/'/g, "''")}'`);
            }
            if (additionalFilters) {
                conditions.push(`(${additionalFilters})`);
            }
            let selectClause = '*';
            if (fieldsToReturn) {
                selectClause = fieldsToReturn
                    .split(',')
                    .map((f) => {
                    const t = f.trim();
                    return t.startsWith('c.') || /\s+AS\s+/i.test(t) ? t : `c.${t}`;
                })
                    .join(', ');
            }
            const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
            const sql = `SELECT TOP ${topK} ${selectClause} FROM c${whereClause} ` +
                `ORDER BY RANK RRF(FullTextScore(c.${textFieldName}, ${safeKeyword}), ` +
                `VectorDistance(c.${vectorFieldName}, ${embeddingLiteral}))`;
            const { resources } = await container.items.query(sql).fetchAll();
            if (!(resources === null || resources === void 0 ? void 0 : resources.length)) {
                const noResult = includeDebugInfo
                    ? { message: 'No results found', query, sql }
                    : { message: 'No results found', query };
                return [[{ json: { output: JSON.stringify(noResult) } }]];
            }
            const reranked = await rerankDocuments(resources, reranker, query, textFieldName);
            const cleaned = reranked.map(stripOutput);
            const output = JSON.stringify(includeDebugInfo
                ? { results: cleaned, debug: { query, sql, embeddingDimensions: embedding.length, resultCount: cleaned.length } }
                : cleaned);
            return [[{ json: { output } }]];
        }
        catch (error) {
            const message = error.message || String(error);
            return [[{ json: { output: JSON.stringify({ error: message }) } }]];
        }
    }
}
exports.CosmosDbHybridSearchTool = CosmosDbHybridSearchTool;
//# sourceMappingURL=CosmosDbHybridSearchTool.node.js.map