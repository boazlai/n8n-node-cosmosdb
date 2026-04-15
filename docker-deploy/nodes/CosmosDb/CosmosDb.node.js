"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmosDb = void 0;
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
class CosmosDb {
    constructor() {
        this.description = {
            displayName: 'Cosmos DB',
            name: 'cosmosDb',
            icon: { light: 'file:database.svg', dark: 'file:lightDatabase.svg' },
            group: ['transform'],
            version: 1,
            description: 'Cosmos DB Node - Upsert documents to Azure Cosmos DB',
            defaults: {
                name: 'Cosmos DB',
            },
            inputs: [
                n8n_workflow_1.NodeConnectionTypes.Main,
                {
                    displayName: 'Embeddings',
                    type: n8n_workflow_1.NodeConnectionTypes.AiEmbedding,
                    required: false,
                    maxConnections: 1,
                },
                {
                    displayName: 'Reranker',
                    type: n8n_workflow_1.NodeConnectionTypes.AiReranker,
                    required: false,
                    maxConnections: 1,
                },
            ],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            usableAsTool: {
                replacements: {
                    description: 'Query or search Azure Cosmos DB. When operation is Hybrid Search, ' +
                        'requires keyword (full-text words) and query (semantic search phrase) inputs.',
                },
            },
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
                        {
                            name: 'Master Key',
                            value: 'masterKey',
                            description: 'Authenticate using the Cosmos DB account master key',
                        },
                        {
                            name: 'Microsoft Entra ID (Azure AD)',
                            value: 'entraId',
                            description: 'Authenticate using Microsoft Entra ID OAuth2 (RBAC)',
                        },
                    ],
                    default: 'masterKey',
                    description: 'The authentication method to use for connecting to Cosmos DB',
                },
                {
                    displayName: 'Resource',
                    name: 'resource',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        { name: 'Item', value: 'item' },
                        { name: 'Container', value: 'container' },
                        { name: 'Database', value: 'database' },
                    ],
                    default: 'item',
                },
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        {
                            name: 'Add',
                            value: 'add',
                            description: 'Add new fields to an existing document',
                            action: 'Add fields to a document',
                        },
                        {
                            name: 'Create or Update',
                            value: 'upsert',
                            description: 'Create a new record, or update the current one if it already exists (upsert)',
                            action: 'Upsert a document',
                        },
                        {
                            name: 'Delete',
                            value: 'delete',
                            description: 'Delete a document by ID and partition key',
                            action: 'Delete a document',
                        },
                        {
                            name: 'Hybrid Search',
                            value: 'hybridSearch',
                            description: 'Perform hybrid search combining full-text and vector search',
                            action: 'Hybrid search documents',
                        },
                        {
                            name: 'Select',
                            value: 'select',
                            description: 'Query and retrieve documents',
                            action: 'Select documents',
                        },
                        {
                            name: 'Set',
                            value: 'set',
                            description: 'Update specific fields on an existing document',
                            action: 'Set fields on a document',
                        },
                    ],
                    displayOptions: {
                        show: {
                            resource: ['item'],
                        },
                    },
                    default: 'select',
                },
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        {
                            name: 'Create',
                            value: 'createContainer',
                            description: 'Create a new container in a database',
                            action: 'Create container',
                        },
                        {
                            name: 'Get',
                            value: 'getContainer',
                            description: 'Retrieve a container definition',
                            action: 'Get container',
                        },
                        {
                            name: 'Get Many',
                            value: 'getManyContainers',
                            description: 'List containers in a database',
                            action: 'Get many containers',
                        },
                        {
                            name: 'Delete',
                            value: 'deleteContainer',
                            description: 'Delete a container from a database',
                            action: 'Delete container',
                        },
                    ],
                    displayOptions: {
                        show: {
                            resource: ['container'],
                        },
                    },
                    default: 'createContainer',
                },
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        {
                            name: 'Create',
                            value: 'createDatabase',
                            description: 'Create a new database in the Cosmos DB account',
                            action: 'Create database',
                        },
                        {
                            name: 'Delete',
                            value: 'deleteDatabase',
                            description: 'Delete a database from the Cosmos DB account',
                            action: 'Delete database',
                        },
                        {
                            name: 'Get',
                            value: 'getDatabase',
                            description: 'Retrieve a database definition',
                            action: 'Get database',
                        },
                        {
                            name: 'Get Many',
                            value: 'getManyDatabases',
                            description: 'List databases in the Cosmos DB account',
                            action: 'Get many databases',
                        },
                    ],
                    displayOptions: {
                        show: {
                            resource: ['database'],
                        },
                    },
                    default: 'createDatabase',
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
                    placeholder: 'Select a database…',
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                        },
                    },
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
                    placeholder: 'Select a container…',
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                        },
                    },
                },
                {
                    displayName: 'Item',
                    name: 'item',
                    type: 'resourceLocator',
                    required: true,
                    default: { mode: 'list', value: '' },
                    placeholder: 'Select an item…',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['delete', 'set', 'add'],
                        },
                    },
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    modes: [
                        {
                            displayName: 'From list',
                            name: 'list',
                            type: 'list',
                            typeOptions: {
                                searchListMethod: 'searchItemIds',
                                searchFilterRequired: false,
                            },
                        },
                        {
                            displayName: 'By ID',
                            name: 'id',
                            type: 'string',
                            placeholder: 'Enter the item ID or use an expression',
                        },
                    ],
                },
                {
                    displayName: 'Partition Key',
                    name: 'partitionKey',
                    type: 'resourceLocator',
                    required: true,
                    default: { mode: 'value', value: '' },
                    description: 'Partition key value for the item',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['delete', 'set', 'add'],
                        },
                    },
                    modes: [
                        {
                            displayName: 'From list',
                            name: 'list',
                            type: 'list',
                            typeOptions: {
                                searchListMethod: 'searchPartitionKeys',
                                searchFilterRequired: false,
                            },
                        },
                        {
                            displayName: 'By value',
                            name: 'value',
                            type: 'string',
                            placeholder: 'Enter the partition key value or use an expression',
                        },
                    ],
                },
                {
                    displayName: 'Fields to Set',
                    name: 'fieldsToSet',
                    type: 'fixedCollection',
                    placeholder: 'Add Field',
                    typeOptions: {
                        multipleValues: true,
                    },
                    default: {},
                    required: true,
                    description: 'Key/value pairs to set on the item. Use JSON Pointer paths like /status or /metadata/title. Values can be JSON (e.g. 123, true, {"a":1}) or plain text.',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['set'],
                        },
                    },
                    options: [
                        {
                            name: 'pairs',
                            displayName: 'Pairs',
                            values: [
                                {
                                    displayName: 'Field Path',
                                    name: 'path',
                                    type: 'string',
                                    default: '',
                                    placeholder: '/status',
                                    description: 'JSON Pointer path to the field to update (must start with /)',
                                },
                                {
                                    displayName: 'Value',
                                    name: 'value',
                                    type: 'string',
                                    default: '',
                                    placeholder: '"active"',
                                    description: 'Value to set. If this is valid JSON it will be parsed; otherwise it will be treated as a string.',
                                },
                            ],
                        },
                    ],
                },
                {
                    displayName: 'Fields to Add',
                    name: 'fieldsToAdd',
                    type: 'fixedCollection',
                    placeholder: 'Add Field',
                    typeOptions: {
                        multipleValues: true,
                    },
                    default: {},
                    required: true,
                    description: 'Key/value pairs to add to the item. Use JSON Pointer paths like /newField or /metadata/tag. Values can be JSON (e.g. 123, true, {"a":1}) or plain text.',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['add'],
                        },
                    },
                    options: [
                        {
                            name: 'pairs',
                            displayName: 'Pairs',
                            values: [
                                {
                                    displayName: 'Field Path',
                                    name: 'path',
                                    type: 'string',
                                    default: '',
                                    placeholder: '/newField',
                                    description: 'JSON Pointer path to the new field to add (must start with /)',
                                },
                                {
                                    displayName: 'Value',
                                    name: 'value',
                                    type: 'string',
                                    default: '',
                                    placeholder: '"new value"',
                                    description: 'Value to add. If this is valid JSON it will be parsed; otherwise it will be treated as a string.',
                                },
                            ],
                        },
                    ],
                },
                {
                    displayName: 'SQL Query',
                    name: 'sqlQuery',
                    type: 'string',
                    typeOptions: {
                        rows: 5,
                    },
                    default: 'SELECT * FROM c ',
                    required: true,
                    placeholder: 'SELECT * FROM c WHERE c.status = "active"',
                    description: 'The SQL query to execute against the container',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['select'],
                        },
                    },
                },
                {
                    displayName: 'Return All',
                    name: 'returnAll',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return all results or only up to a given limit',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['select'],
                        },
                    },
                },
                {
                    displayName: 'Limit',
                    name: 'limit',
                    type: 'number',
                    default: 50,
                    placeholder: '50',
                    typeOptions: {
                        minValue: 1,
                    },
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['select'],
                            returnAll: [false],
                        },
                    },
                    description: 'Max number of results to return',
                },
                {
                    displayName: 'Simplify Output',
                    name: 'simplifyOutput',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to exclude internal Cosmos DB fields (_rid, _self, _etag, _attachments, _ts)',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['select'],
                        },
                    },
                },
                {
                    displayName: 'Exclude Fields',
                    name: 'excludeFields',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to exclude additional specific fields from the results',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['select'],
                        },
                    },
                },
                {
                    displayName: 'Fields to Exclude',
                    name: 'fieldsToExclude',
                    type: 'string',
                    default: 'vector,text',
                    placeholder: 'field1,field2,field3',
                    description: 'Comma-separated list of field names to exclude from results',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['select'],
                            excludeFields: [true],
                        },
                    },
                },
                {
                    displayName: 'Item Content',
                    name: 'itemContent',
                    type: 'json',
                    default: '{\n\t"id": "my-document-id",\n\t"category": ""\n}',
                    required: true,
                    description: 'The JSON document to upsert. Must include an "ID" field and the partition key field defined in your container.',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                        },
                    },
                },
                {
                    displayName: 'Add Metadata',
                    name: 'addMetadata',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to add metadata key/value pairs that will be merged into document.metadata',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                        },
                    },
                },
                {
                    displayName: 'Metadata',
                    name: 'metadata',
                    type: 'fixedCollection',
                    placeholder: 'Add Metadata',
                    typeOptions: {
                        multipleValues: true,
                    },
                    default: {},
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                            addMetadata: [true],
                        },
                    },
                    options: [
                        {
                            name: 'pairs',
                            displayName: 'Pairs',
                            values: [
                                {
                                    displayName: 'Key',
                                    name: 'key',
                                    type: 'string',
                                    default: '',
                                    placeholder: 'myKey',
                                    description: 'The metadata key name',
                                },
                                {
                                    displayName: 'Value',
                                    name: 'value',
                                    type: 'string',
                                    default: '',
                                    placeholder: 'myValue',
                                    description: 'The metadata value',
                                },
                            ],
                        },
                    ],
                    description: 'Key-value pairs to add to the document metadata field',
                },
                {
                    displayName: 'Add Embedding',
                    name: 'addEmbedding',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to generate and add an embedding vector to the document',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                        },
                    },
                },
                {
                    displayName: 'Vector Field Name',
                    name: 'vectorFieldName',
                    type: 'string',
                    default: 'vector',
                    required: true,
                    placeholder: 'vector',
                    description: 'The field name where the embedding vector will be stored',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                            addEmbedding: [true],
                        },
                    },
                },
                {
                    displayName: 'Text to Embed',
                    name: 'textToEmbed',
                    type: 'string',
                    default: '',
                    required: true,
                    placeholder: 'text',
                    description: 'The text content to generate embedding for. You can use expressions to reference document fields.',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                            addEmbedding: [true],
                        },
                    },
                },
                {
                    displayName: 'Add Text',
                    name: 'addText',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to add a text field to the document',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                        },
                    },
                },
                {
                    displayName: 'Text Field Name',
                    name: 'textFieldName',
                    type: 'string',
                    default: 'text',
                    required: true,
                    placeholder: 'text',
                    description: 'The field name where the text content will be stored',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                            addText: [true],
                        },
                    },
                },
                {
                    displayName: 'Text Content',
                    name: 'textContent',
                    type: 'string',
                    default: '',
                    required: true,
                    placeholder: 'Enter text content',
                    description: 'The text content to add to the document. You can use expressions to reference other fields.',
                    displayOptions: {
                        show: {
                            resource: ['item'],
                            operation: ['upsert'],
                            addText: [true],
                        },
                    },
                },
                {
                    displayName: 'Database Name or ID',
                    name: 'databaseNameForCreate',
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
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                        },
                    },
                },
                {
                    displayName: 'Container Name',
                    name: 'newContainerName',
                    type: 'string',
                    default: '',
                    required: true,
                    placeholder: 'Enter container name',
                    description: 'Name for the new container',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                        },
                    },
                },
                {
                    displayName: 'Partition Key Path',
                    name: 'partitionKeyPath',
                    type: 'string',
                    default: '/category',
                    required: true,
                    placeholder: '/category',
                    description: 'Partition key path for the new container (must start with /)',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                        },
                    },
                },
                {
                    displayName: 'Add Vector Policy',
                    name: 'addVectorPolicy',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to enable vector search on this container',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                        },
                    },
                },
                {
                    displayName: 'Vector Path',
                    name: 'vectorPath',
                    type: 'string',
                    default: '/vector',
                    required: true,
                    placeholder: '/vector',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                            addVectorPolicy: [true],
                        },
                    },
                    description: 'Path of the vector field (must start with /)',
                },
                {
                    displayName: 'Vector Data Type',
                    name: 'vectorDataType',
                    type: 'options',
                    default: 'float32',
                    options: [
                        { name: 'Float32', value: 'float32' },
                        { name: 'Float16', value: 'float16' },
                        { name: 'Int8', value: 'int8' },
                    ],
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                            addVectorPolicy: [true],
                        },
                    },
                    description: 'Vector embedding data type',
                },
                {
                    displayName: 'Distance Function',
                    name: 'vectorDistanceFunction',
                    type: 'options',
                    default: 'cosine',
                    options: [
                        { name: 'Cosine', value: 'cosine' },
                        { name: 'Euclidean', value: 'euclidean' },
                        { name: 'Dot Product', value: 'dotProduct' },
                    ],
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                            addVectorPolicy: [true],
                        },
                    },
                    description: 'Distance function used for vector similarity',
                },
                {
                    displayName: 'Dimensions',
                    name: 'vectorDimensions',
                    type: 'number',
                    default: 1536,
                    required: true,
                    description: 'Number of dimensions in the vector embeddings',
                    typeOptions: {
                        minValue: 1,
                        maxValue: 65535,
                    },
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                            addVectorPolicy: [true],
                        },
                    },
                },
                {
                    displayName: 'Index Type',
                    name: 'vectorIndexType',
                    type: 'options',
                    default: 'diskANN',
                    options: [
                        { name: 'diskANN', value: 'diskANN' },
                        { name: 'quantizedFlat', value: 'quantizedFlat' },
                    ],
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                            addVectorPolicy: [true],
                        },
                    },
                    description: 'Vector index type for the container',
                },
                {
                    displayName: 'Add Full Text Search Policy',
                    name: 'addFullTextPolicy',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to enable full text search on this container',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                        },
                    },
                },
                {
                    displayName: 'Full Text Path',
                    name: 'fullTextPath',
                    type: 'string',
                    default: '/text',
                    required: true,
                    placeholder: '/text',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['createContainer'],
                            addFullTextPolicy: [true],
                        },
                    },
                    description: 'Path of the text field to enable for full-text search',
                },
                {
                    displayName: 'Database Name or ID',
                    name: 'databaseNameForContainer',
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
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['getContainer', 'deleteContainer', 'getManyContainers'],
                        },
                    },
                },
                {
                    displayName: 'Container Name or ID',
                    name: 'containerNameForContainer',
                    type: 'options',
                    typeOptions: {
                        loadOptionsDependsOn: [
                            'databaseNameForContainer',
                            'authenticationType',
                            'useDevOverride',
                            'customEndpoint',
                            'customAccessToken',
                        ],
                        loadOptionsMethod: 'getContainersForContainerOps',
                    },
                    default: '',
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['getContainer', 'deleteContainer'],
                        },
                    },
                },
                {
                    displayName: 'Return All',
                    name: 'containersReturnAll',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return all containers or only up to a given limit',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['getManyContainers'],
                        },
                    },
                },
                {
                    displayName: 'Limit',
                    name: 'containersLimit',
                    type: 'number',
                    default: 50,
                    placeholder: '50',
                    typeOptions: {
                        minValue: 1,
                    },
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['getManyContainers'],
                            containersReturnAll: [false],
                        },
                    },
                    description: 'Max number of containers to return',
                },
                {
                    displayName: 'Simplify Output',
                    name: 'simplifyContainerOutput',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return a simplified shape with common fields',
                    displayOptions: {
                        show: {
                            resource: ['container'],
                            operation: ['getContainer', 'getManyContainers'],
                        },
                    },
                },
                {
                    displayName: 'Database Name',
                    name: 'newDatabaseName',
                    type: 'string',
                    default: '',
                    required: true,
                    placeholder: 'Enter database name',
                    description: 'Name for the new database',
                    displayOptions: {
                        show: {
                            resource: ['database'],
                            operation: ['createDatabase'],
                        },
                    },
                },
                {
                    displayName: 'Throughput (RU/s)',
                    name: 'dbThroughput',
                    type: 'number',
                    default: 400,
                    typeOptions: {
                        minValue: 100,
                    },
                    description: 'Optional manual provisioned throughput in RU/s. Leave at 0 to use shared or serverless account defaults.',
                    displayOptions: {
                        show: {
                            resource: ['database'],
                            operation: ['createDatabase'],
                        },
                    },
                },
                {
                    displayName: 'Database Name or ID',
                    name: 'databaseNameForDbOps',
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
                    required: true,
                    description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
                    displayOptions: {
                        show: {
                            resource: ['database'],
                            operation: ['getDatabase', 'deleteDatabase'],
                        },
                    },
                },
                {
                    displayName: 'Return All',
                    name: 'dbReturnAll',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return all databases or only up to a given limit',
                    displayOptions: {
                        show: {
                            resource: ['database'],
                            operation: ['getManyDatabases'],
                        },
                    },
                },
                {
                    displayName: 'Limit',
                    name: 'dbLimit',
                    type: 'number',
                    default: 50,
                    placeholder: '50',
                    typeOptions: {
                        minValue: 1,
                    },
                    displayOptions: {
                        show: {
                            resource: ['database'],
                            operation: ['getManyDatabases'],
                            dbReturnAll: [false],
                        },
                    },
                    description: 'Max number of databases to return',
                },
                {
                    displayName: 'Simplify Output',
                    name: 'simplifyDatabaseOutput',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return a simplified shape with common fields only',
                    displayOptions: {
                        show: {
                            resource: ['database'],
                            operation: ['getDatabase', 'getManyDatabases'],
                        },
                    },
                },
                {
                    displayName: 'Keyword (Full Text Search)',
                    name: 'keyword',
                    type: 'string',
                    default: '',
                    placeholder: 'Enter full-text search keywords',
                    description: 'Keywords for full-text search. When used as an AI tool, the agent will fill this automatically.',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Search Query (Vector Search)',
                    name: 'searchQuery',
                    type: 'string',
                    default: '',
                    placeholder: 'Enter semantic search query',
                    description: 'Query text for vector embedding search (used in VectorDistance). When used as an AI tool, the agent will fill this automatically.',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Vector Field Name',
                    name: 'hybridVectorFieldName',
                    type: 'string',
                    default: 'vector',
                    required: true,
                    placeholder: 'vector',
                    description: 'The document field used for vector search',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Full Text Field Name',
                    name: 'hybridTextFieldName',
                    type: 'string',
                    default: 'text',
                    required: true,
                    placeholder: 'text',
                    description: 'The document field used for full-text search',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Top K',
                    name: 'topK',
                    type: 'number',
                    default: 10,
                    required: true,
                    placeholder: '10',
                    typeOptions: {
                        minValue: 1,
                        maxValue: 1000,
                    },
                    description: 'Number of top results to retrieve from the database',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Partition Key Field',
                    name: 'partitionKeyField',
                    type: 'string',
                    default: 'category',
                    required: true,
                    placeholder: 'category',
                    description: 'The partition key field name (e.g., category, ID)',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Partition Key Value',
                    name: 'partitionKeyValue',
                    type: 'string',
                    default: '',
                    required: true,
                    placeholder: '',
                    description: 'The partition key value for filtering (optional - leave empty if not needed)',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Additional SQL Filters',
                    name: 'additionalFilters',
                    type: 'string',
                    default: '',
                    placeholder: 'c.published = true AND c.year > 2020',
                    typeOptions: {
                        rows: 3,
                    },
                    description: 'Optional additional WHERE conditions to filter results before RRF ranking. Example: c.status = "active" AND c.priority > 5.',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Fields to Return',
                    name: 'fieldsToReturn',
                    type: 'string',
                    default: '',
                    placeholder: 'ID, title, summary, publishedDate',
                    description: 'Optional comma-separated list of field names to return. Leave empty to return all fields (*).',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Simplify Output',
                    name: 'simplifyOutput',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to exclude internal Cosmos DB fields (_rid, _self, _etag, _attachments, _ts)',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Exclude Fields',
                    name: 'excludeFields',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to exclude additional specific fields from the results',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                        },
                    },
                },
                {
                    displayName: 'Fields to Exclude',
                    name: 'fieldsToExclude',
                    type: 'string',
                    default: 'vector,text',
                    placeholder: 'field1,field2,field3',
                    description: 'Comma-separated list of field names to exclude from results',
                    displayOptions: {
                        show: {
                            operation: ['hybridSearch'],
                            excludeFields: [true],
                        },
                    },
                },
                {
                    displayName: 'Use Dev Override (Custom Endpoint + Token)',
                    name: 'useDevOverride',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to bypass OAuth and use a manually supplied endpoint and bearer token. Useful in dev environments where the OAuth flow is unavailable.',
                },
                {
                    displayName: 'Custom Endpoint',
                    name: 'customEndpoint',
                    type: 'string',
                    default: '',
                    placeholder: 'https://your-account.documents.azure.com:443/',
                    description: 'The Cosmos DB account endpoint URL',
                    displayOptions: { show: { useDevOverride: [true] } },
                },
                {
                    displayName: 'Custom Access Token',
                    name: 'customAccessToken',
                    type: 'string',
                    typeOptions: { password: true },
                    default: '',
                    description: 'A bearer token scoped to https://cosmos.azure.com/. Supports expressions — you can pass the full "Bearer eyJ..." value from a previous HTTP Request node.',
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
                        const endpoint = credentials.endpoint;
                        const key = credentials.key;
                        client = new cosmos_1.CosmosClient({ endpoint, key });
                    }
                    try {
                        const { resources } = await client.databases.readAll().fetchAll();
                        const options = resources.map((db) => ({
                            name: db.id,
                            value: db.id,
                        }));
                        return prioritizeMatchingOption(options, preferredUserScopedName);
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load databases: ${error.message}`);
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
                        const endpoint = credentials.endpoint;
                        const key = credentials.key;
                        client = new cosmos_1.CosmosClient({ endpoint, key });
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
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load containers: ${error.message}`);
                    }
                },
                async getContainersForContainerOps() {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const databaseName = this.getCurrentNodeParameter('databaseNameForContainer');
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
                        const endpoint = credentials.endpoint;
                        const key = credentials.key;
                        client = new cosmos_1.CosmosClient({ endpoint, key });
                    }
                    try {
                        const database = client.database(databaseName);
                        const { resources } = await database.containers.readAll().fetchAll();
                        const options = resources.map((container) => ({
                            name: container.id,
                            value: container.id,
                        }));
                        return prioritizeMatchingOption(options, preferredUserScopedName, 'Your container');
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load containers: ${error.message}`);
                    }
                },
                async getItemIds() {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const databaseName = this.getCurrentNodeParameter('databaseName');
                    const containerName = this.getCurrentNodeParameter('containerName');
                    if (!databaseName || !containerName)
                        return [];
                    let client;
                    const customEndpoint = (this.getNodeParameter('customEndpoint', '') || '').trim();
                    const customAccessToken = (this.getNodeParameter('customAccessToken', '') || '').trim();
                    if (customEndpoint && customAccessToken) {
                        client = new cosmos_1.CosmosClient({
                            endpoint: customEndpoint,
                            aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
                        });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const endpoint = creds.endpoint;
                        const oauthTokenData = creds.oauthTokenData;
                        client = new cosmos_1.CosmosClient({
                            endpoint,
                            aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
                        });
                    }
                    else {
                        const credentials = await this.getCredentials('cosmosDbApi');
                        const endpoint = credentials.endpoint;
                        const key = credentials.key;
                        client = new cosmos_1.CosmosClient({ endpoint, key });
                    }
                    try {
                        const container = client.database(databaseName).container(containerName);
                        const query = {
                            query: 'SELECT c.id FROM c',
                        };
                        const { resources } = await container.items
                            .query(query, { maxItemCount: 200 })
                            .fetchAll();
                        return resources
                            .map((r) => r.id)
                            .filter((id) => typeof id === 'string')
                            .slice(0, 200)
                            .map((id) => ({ name: id, value: id }));
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to load item IDs: ${error.message}`);
                    }
                },
                async searchItemIds(filter) {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const databaseName = this.getCurrentNodeParameter('databaseName');
                    const containerName = this.getCurrentNodeParameter('containerName');
                    if (!databaseName || !containerName)
                        return [];
                    let client;
                    const customEndpoint = (this.getNodeParameter('customEndpoint', '') || '').trim();
                    const customAccessToken = (this.getNodeParameter('customAccessToken', '') || '').trim();
                    if (customEndpoint && customAccessToken) {
                        client = new cosmos_1.CosmosClient({
                            endpoint: customEndpoint,
                            aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
                        });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const endpoint = creds.endpoint;
                        const oauthTokenData = creds.oauthTokenData;
                        client = new cosmos_1.CosmosClient({
                            endpoint,
                            aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
                        });
                    }
                    else {
                        const credentials = await this.getCredentials('cosmosDbApi');
                        const endpoint = credentials.endpoint;
                        const key = credentials.key;
                        client = new cosmos_1.CosmosClient({ endpoint, key });
                    }
                    try {
                        const container = client.database(databaseName).container(containerName);
                        const querySpec = { query: 'SELECT c.id FROM c' };
                        const { resources } = await container.items
                            .query(querySpec, { maxItemCount: 200 })
                            .fetchAll();
                        const ids = resources
                            .map((r) => r.id)
                            .filter((id) => typeof id === 'string');
                        const normalizedFilter = (filter || '').toLowerCase();
                        return ids
                            .filter((id) => !normalizedFilter || id.toLowerCase().includes(normalizedFilter))
                            .slice(0, 200)
                            .map((id) => ({ name: id, value: id }));
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to search item IDs: ${error.message}`);
                    }
                },
            },
            listSearch: {
                async searchItemIds(filter) {
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const databaseName = this.getCurrentNodeParameter('databaseName');
                    const containerName = this.getCurrentNodeParameter('containerName');
                    if (!databaseName || !containerName)
                        return { results: [] };
                    let client;
                    const customEndpoint = (this.getNodeParameter('customEndpoint', '') || '').trim();
                    const customAccessToken = (this.getNodeParameter('customAccessToken', '') || '').trim();
                    if (customEndpoint && customAccessToken) {
                        client = new cosmos_1.CosmosClient({
                            endpoint: customEndpoint,
                            aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
                        });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const endpoint = creds.endpoint;
                        const oauthTokenData = creds.oauthTokenData;
                        client = new cosmos_1.CosmosClient({
                            endpoint,
                            aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
                        });
                    }
                    else {
                        const credentials = await this.getCredentials('cosmosDbApi');
                        const endpoint = credentials.endpoint;
                        const key = credentials.key;
                        client = new cosmos_1.CosmosClient({ endpoint, key });
                    }
                    try {
                        const container = client.database(databaseName).container(containerName);
                        const query = { query: 'SELECT VALUE c.id FROM c' };
                        const { resources } = await container.items
                            .query(query, { maxItemCount: 200 })
                            .fetchAll();
                        const ids = resources.filter((v) => typeof v === 'string');
                        const f = (filter || '').toLowerCase();
                        return {
                            results: ids
                                .filter((id) => !f || id.toLowerCase().includes(f))
                                .slice(0, 200)
                                .map((id) => ({ name: id, value: id })),
                        };
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to search item IDs: ${error.message}`);
                    }
                },
                async searchPartitionKeys(filter) {
                    var _a, _b, _c;
                    const authenticationType = this.getNodeParameter('authenticationType', 0);
                    const databaseName = this.getCurrentNodeParameter('databaseName');
                    const containerName = this.getCurrentNodeParameter('containerName');
                    if (!databaseName || !containerName)
                        return { results: [] };
                    let client;
                    const customEndpoint = (this.getNodeParameter('customEndpoint', '') || '').trim();
                    const customAccessToken = (this.getNodeParameter('customAccessToken', '') || '').trim();
                    if (customEndpoint && customAccessToken) {
                        client = new cosmos_1.CosmosClient({
                            endpoint: customEndpoint,
                            aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
                        });
                    }
                    else if (authenticationType === 'entraId') {
                        const creds = await this.getCredentials('cosmosDbEntraIdApi');
                        const endpoint = creds.endpoint;
                        const oauthTokenData = creds.oauthTokenData;
                        client = new cosmos_1.CosmosClient({
                            endpoint,
                            aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
                        });
                    }
                    else {
                        const credentials = await this.getCredentials('cosmosDbApi');
                        const endpoint = credentials.endpoint;
                        const key = credentials.key;
                        client = new cosmos_1.CosmosClient({ endpoint, key });
                    }
                    try {
                        const container = client.database(databaseName).container(containerName);
                        const def = await container.read();
                        const pkPathRaw = ((_c = (_b = (_a = def.resource) === null || _a === void 0 ? void 0 : _a.partitionKey) === null || _b === void 0 ? void 0 : _b.paths) === null || _c === void 0 ? void 0 : _c[0]) || '/id';
                        const pkField = pkPathRaw.replace('/', '');
                        const query = {
                            query: `SELECT DISTINCT VALUE c.${pkField} FROM c WHERE IS_DEFINED(c.${pkField})`,
                        };
                        const { resources } = await container.items
                            .query(query, { maxItemCount: 200 })
                            .fetchAll();
                        const values = resources.filter((v) => typeof v === 'string' || typeof v === 'number');
                        const f = (filter || '').toLowerCase();
                        return {
                            results: values
                                .map((v) => ({ name: String(v), value: v }))
                                .filter((kv) => !f || kv.name.toLowerCase().includes(f))
                                .slice(0, 200),
                        };
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to search partition keys: ${error.message}`);
                    }
                },
            },
        };
    }
    async execute() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const items = this.getInputData();
        const returnData = [];
        const authenticationType = this.getNodeParameter('authenticationType', 0);
        let client;
        const customEndpoint = this.getNodeParameter('customEndpoint', 0, '').trim();
        const customAccessToken = this.getNodeParameter('customAccessToken', 0, '').trim();
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
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'No valid Entra ID access token found. Please re-authenticate the "Cosmos DB (Microsoft Entra ID / Azure AD) API" credential, or supply a Custom Endpoint and Custom Access Token via the Dev Override option.');
            }
            client = new cosmos_1.CosmosClient({
                endpoint,
                aadCredentials: new N8nCosmosTokenCredential(oauthTokenData.access_token, oauthTokenData.expires_at),
            });
        }
        else {
            const credentials = await this.getCredentials('cosmosDbApi');
            const endpoint = credentials.endpoint;
            const key = credentials.key;
            client = new cosmos_1.CosmosClient({ endpoint, key });
        }
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                const resource = this.getNodeParameter('resource', itemIndex);
                const operation = this.getNodeParameter('operation', itemIndex);
                const databaseName = resource === 'item'
                    ? this.getNodeParameter('databaseName', itemIndex)
                    : this.getNodeParameter('databaseNameForCreate', itemIndex, '');
                const containerName = resource === 'item' ? this.getNodeParameter('containerName', itemIndex) : '';
                const database = client.database(databaseName);
                const container = containerName ? database.container(containerName) : undefined;
                if (resource === 'container' && operation === 'createContainer') {
                    const newContainerName = this.getNodeParameter('newContainerName', itemIndex);
                    const trimmedName = (newContainerName || '').trim();
                    if (!trimmedName) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Container name is required', {
                            itemIndex,
                        });
                    }
                    if (trimmedName.length > 255) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Container name must be 1–255 characters long', { itemIndex });
                    }
                    if (!/^[A-Za-z0-9_-]+$/.test(trimmedName)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Container name can only contain letters, numbers, hyphens (-), and underscores (_).', { itemIndex });
                    }
                    let partitionKeyPath = this.getNodeParameter('partitionKeyPath', itemIndex, '/category');
                    partitionKeyPath = partitionKeyPath.startsWith('/')
                        ? partitionKeyPath
                        : `/${partitionKeyPath}`;
                    const addVectorPolicy = this.getNodeParameter('addVectorPolicy', itemIndex, false);
                    const addFullTextPolicy = this.getNodeParameter('addFullTextPolicy', itemIndex, false);
                    const containerDef = {
                        id: trimmedName,
                        partitionKey: { paths: [partitionKeyPath], kind: 'Hash' },
                    };
                    if (addVectorPolicy) {
                        let vectorPath = this.getNodeParameter('vectorPath', itemIndex, '/vector');
                        vectorPath = vectorPath.startsWith('/') ? vectorPath : `/${vectorPath}`;
                        const vectorDataType = this.getNodeParameter('vectorDataType', itemIndex, 'float32');
                        const vectorDistanceFunction = this.getNodeParameter('vectorDistanceFunction', itemIndex, 'cosine');
                        const vectorDimensions = this.getNodeParameter('vectorDimensions', itemIndex, 1536);
                        const vectorIndexType = this.getNodeParameter('vectorIndexType', itemIndex, 'diskANN');
                        containerDef.vectorEmbeddingPolicy = {
                            vectorEmbeddings: [
                                {
                                    path: vectorPath,
                                    dataType: vectorDataType,
                                    distanceFunction: vectorDistanceFunction,
                                    dimensions: vectorDimensions,
                                },
                            ],
                        };
                        containerDef.indexingPolicy = {
                            ...(containerDef.indexingPolicy || {}),
                            vectorIndexes: [
                                {
                                    path: vectorPath,
                                    type: vectorIndexType,
                                },
                            ],
                        };
                    }
                    if (addFullTextPolicy) {
                        let fullTextPath = this.getNodeParameter('fullTextPath', itemIndex, '/text');
                        fullTextPath = fullTextPath.startsWith('/') ? fullTextPath : `/${fullTextPath}`;
                        containerDef.fullTextPolicy = {
                            defaultLanguage: 'en-US',
                            paths: [fullTextPath],
                        };
                    }
                    const { resource: created } = await database.containers.create(containerDef);
                    returnData.push({ json: created || { id: trimmedName }, pairedItem: itemIndex });
                    continue;
                }
                if (operation === 'select') {
                    const sqlQuery = this.getNodeParameter('sqlQuery', itemIndex);
                    const returnAll = this.getNodeParameter('returnAll', itemIndex, true);
                    const limit = this.getNodeParameter('limit', itemIndex, 50);
                    const simplifyOutput = this.getNodeParameter('simplifyOutput', itemIndex, true);
                    const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false);
                    const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '');
                    const { resources } = await container.items.query(sqlQuery).fetchAll();
                    const internalFields = ['_rid', '_self', '_etag', '_attachments', '_ts'];
                    const resultSet = returnAll ? resources : resources.slice(0, limit);
                    for (const resource of resultSet) {
                        let processedResource = resource;
                        if (simplifyOutput) {
                            processedResource = { ...resource };
                            for (const field of internalFields) {
                                delete processedResource[field];
                            }
                        }
                        if (excludeFields && fieldsToExclude) {
                            const fieldsArray = fieldsToExclude
                                .split(',')
                                .map((f) => f.trim())
                                .filter((f) => f.length > 0);
                            processedResource = { ...processedResource };
                            for (const field of fieldsArray) {
                                delete processedResource[field];
                            }
                        }
                        returnData.push({
                            json: processedResource,
                            pairedItem: itemIndex,
                        });
                    }
                }
                else if (operation === 'set') {
                    const partitionKeyParam = this.getNodeParameter('partitionKey', itemIndex);
                    const partitionKey = typeof partitionKeyParam === 'string' ? partitionKeyParam : partitionKeyParam === null || partitionKeyParam === void 0 ? void 0 : partitionKeyParam.value;
                    const itemParam = this.getNodeParameter('item', itemIndex);
                    const id = typeof itemParam === 'string' ? itemParam : itemParam === null || itemParam === void 0 ? void 0 : itemParam.value;
                    if (!id) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Item ID is required for set', {
                            itemIndex,
                        });
                    }
                    if (partitionKey === undefined || partitionKey === null || partitionKey === '') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Partition key value is required for set. Enter the exact partition key for this item.', { itemIndex });
                    }
                    const fieldsToSet = this.getNodeParameter('fieldsToSet', itemIndex, {});
                    const pairs = fieldsToSet.pairs || [];
                    if (!pairs.length) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Add at least one field to set', {
                            itemIndex,
                        });
                    }
                    const operations = pairs
                        .filter((p) => p && typeof p.path === 'string' && p.path.trim() !== '')
                        .map((p) => {
                        var _a;
                        const rawPath = (p.path || '').trim();
                        const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
                        const rawValue = ((_a = p.value) !== null && _a !== void 0 ? _a : '').toString();
                        let parsedValue = rawValue;
                        try {
                            parsedValue = JSON.parse(rawValue);
                        }
                        catch {
                            parsedValue = rawValue;
                        }
                        return { op: 'set', path, value: parsedValue };
                    });
                    if (!operations.length) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Fields to Set contains no valid paths. Provide at least one Field Path.', { itemIndex });
                    }
                    const response = await container.item(id, partitionKey).patch(operations);
                    returnData.push({
                        json: (response === null || response === void 0 ? void 0 : response.resource) || {
                            id,
                            partitionKey,
                            statusCode: response === null || response === void 0 ? void 0 : response.statusCode,
                            updated: (response === null || response === void 0 ? void 0 : response.statusCode) >= 200 && (response === null || response === void 0 ? void 0 : response.statusCode) < 300,
                        },
                        pairedItem: itemIndex,
                    });
                }
                else if (operation === 'add') {
                    const partitionKeyParam = this.getNodeParameter('partitionKey', itemIndex);
                    const partitionKey = typeof partitionKeyParam === 'string' ? partitionKeyParam : partitionKeyParam === null || partitionKeyParam === void 0 ? void 0 : partitionKeyParam.value;
                    const itemParam = this.getNodeParameter('item', itemIndex);
                    const id = typeof itemParam === 'string' ? itemParam : itemParam === null || itemParam === void 0 ? void 0 : itemParam.value;
                    if (!id) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Item ID is required for add', {
                            itemIndex,
                        });
                    }
                    if (partitionKey === undefined || partitionKey === null || partitionKey === '') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Partition key value is required for add. Enter the exact partition key for this item.', { itemIndex });
                    }
                    const fieldsToAdd = this.getNodeParameter('fieldsToAdd', itemIndex, {});
                    const pairs = fieldsToAdd.pairs || [];
                    if (!pairs.length) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Add at least one field to add', {
                            itemIndex,
                        });
                    }
                    const operations = pairs
                        .filter((p) => p && typeof p.path === 'string' && p.path.trim() !== '')
                        .map((p) => {
                        var _a;
                        const rawPath = (p.path || '').trim();
                        const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
                        const rawValue = ((_a = p.value) !== null && _a !== void 0 ? _a : '').toString();
                        let parsedValue = rawValue;
                        try {
                            parsedValue = JSON.parse(rawValue);
                        }
                        catch {
                            parsedValue = rawValue;
                        }
                        return { op: 'add', path, value: parsedValue };
                    });
                    if (!operations.length) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Fields to Add contains no valid paths. Provide at least one Field Path.', { itemIndex });
                    }
                    const response = await container.item(id, partitionKey).patch(operations);
                    returnData.push({
                        json: (response === null || response === void 0 ? void 0 : response.resource) || {
                            id,
                            partitionKey,
                            statusCode: response === null || response === void 0 ? void 0 : response.statusCode,
                            added: (response === null || response === void 0 ? void 0 : response.statusCode) >= 200 && (response === null || response === void 0 ? void 0 : response.statusCode) < 300,
                        },
                        pairedItem: itemIndex,
                    });
                }
                else if (operation === 'upsert') {
                    const documentsToProcess = [];
                    for (let i = itemIndex; i < items.length; i++) {
                        const currentOperation = this.getNodeParameter('operation', i);
                        if (currentOperation !== 'upsert') {
                            break;
                        }
                        const documentJson = this.getNodeParameter('itemContent', i);
                        let document;
                        try {
                            document = typeof documentJson === 'string' ? JSON.parse(documentJson) : documentJson;
                        }
                        catch (error) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Invalid JSON in Document field', {
                                itemIndex: i,
                            });
                        }
                        const addMetadata = this.getNodeParameter('addMetadata', i, false);
                        if (addMetadata) {
                            const metadataCollection = this.getNodeParameter('metadata', i, {});
                            const pairs = metadataCollection.pairs || [];
                            const metadataObj = {};
                            for (const pair of pairs) {
                                if (pair && pair.key) {
                                    metadataObj[pair.key] = pair.value;
                                }
                            }
                            document.metadata = { ...(document.metadata || {}), ...metadataObj };
                        }
                        const addEmbedding = this.getNodeParameter('addEmbedding', i, false);
                        const addText = this.getNodeParameter('addText', i, false);
                        documentsToProcess.push({
                            document,
                            itemIndex: i,
                            addEmbedding,
                            vectorFieldName: addEmbedding
                                ? this.getNodeParameter('vectorFieldName', i)
                                : undefined,
                            textToEmbed: addEmbedding
                                ? this.getNodeParameter('textToEmbed', i)
                                : undefined,
                            addText,
                            textFieldName: addText
                                ? this.getNodeParameter('textFieldName', i)
                                : undefined,
                            textContent: addText
                                ? this.getNodeParameter('textContent', i)
                                : undefined,
                        });
                    }
                    const textsToEmbed = documentsToProcess
                        .filter((item) => item.addEmbedding)
                        .map((item) => item.textToEmbed);
                    let embeddings = [];
                    if (textsToEmbed.length > 0) {
                        const aiData = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiEmbedding, 0));
                        if (!aiData) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'No embedding model connected. Please connect an Embeddings node to the AI input.', { itemIndex });
                        }
                        if (typeof aiData.embedDocuments === 'function') {
                            embeddings = await aiData.embedDocuments(textsToEmbed);
                        }
                        else if (typeof aiData.embedQuery === 'function') {
                            embeddings = await Promise.all(textsToEmbed.map((text) => aiData.embedQuery(text)));
                        }
                        else {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Embedding model does not support embedQuery or embedDocuments methods.', { itemIndex });
                        }
                    }
                    let embeddingIndex = 0;
                    for (const item of documentsToProcess) {
                        const { document, itemIndex: currentItemIndex } = item;
                        if (item.addEmbedding && item.vectorFieldName) {
                            document[item.vectorFieldName] = embeddings[embeddingIndex];
                            embeddingIndex++;
                        }
                        if (item.addText && item.textFieldName) {
                            document[item.textFieldName] = item.textContent;
                        }
                        const containerDef = await container.read();
                        const partitionKeyPath = ((_d = (_c = (_b = (_a = containerDef.resource) === null || _a === void 0 ? void 0 : _a.partitionKey) === null || _b === void 0 ? void 0 : _b.paths) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.replace('/', '')) || 'id';
                        const hasPkField = Object.prototype.hasOwnProperty.call(document, partitionKeyPath);
                        if (!hasPkField) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Document must include the partition key field '${partitionKeyPath}'. Add this field to your document.`, { itemIndex: currentItemIndex });
                        }
                        const pkValue = document[partitionKeyPath];
                        const isEmptyString = typeof pkValue === 'string' && pkValue.trim() === '';
                        if (pkValue === undefined || pkValue === null || isEmptyString) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Partition key '${partitionKeyPath}' must have a non-empty value when creating or updating an item.`, { itemIndex: currentItemIndex });
                        }
                        const { resource } = await container.items.upsert(document);
                        returnData.push({
                            json: resource || document,
                            pairedItem: currentItemIndex,
                        });
                    }
                    itemIndex += documentsToProcess.length - 1;
                }
                else if (operation === 'hybridSearch') {
                    const keyword = this.getNodeParameter('keyword', itemIndex);
                    const searchQuery = this.getNodeParameter('searchQuery', itemIndex);
                    const hybridVectorFieldName = this.getNodeParameter('hybridVectorFieldName', itemIndex, 'Vector');
                    const hybridTextFieldName = this.getNodeParameter('hybridTextFieldName', itemIndex, 'text');
                    const topK = this.getNodeParameter('topK', itemIndex, 10);
                    const partitionKeyField = this.getNodeParameter('partitionKeyField', itemIndex, 'category');
                    const partitionKeyValue = this.getNodeParameter('partitionKeyValue', itemIndex, '');
                    const additionalFilters = this.getNodeParameter('additionalFilters', itemIndex, '');
                    const fieldsToReturn = this.getNodeParameter('fieldsToReturn', itemIndex, '');
                    const simplifyOutput = this.getNodeParameter('simplifyOutput', itemIndex, true);
                    const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false);
                    const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '');
                    const aiData = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiEmbedding, 0));
                    const reranker = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiReranker, 0));
                    if (!aiData || typeof aiData.embedQuery !== 'function') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'AI Embedding is required for hybrid search. Please connect an embeddings node to the Embedding input.', { itemIndex });
                    }
                    const embedding = await aiData.embedQuery(searchQuery);
                    const normalizeOptionalSqlInput = (value) => {
                        const trimmed = (value !== null && value !== void 0 ? value : '').trim();
                        if (!trimmed || /^((""|''|null|undefined))$/i.test(trimmed)) {
                            return '';
                        }
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (typeof parsed === 'string') {
                                return parsed.trim();
                            }
                        }
                        catch {
                        }
                        return trimmed;
                    };
                    const escapeDoubleQuotes = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    const escapeSingleQuotes = (s) => s.replace(/'/g, "''");
                    const buildDocumentFieldReference = (fieldName, parameterName) => {
                        const normalizedFieldName = normalizeOptionalSqlInput(fieldName);
                        if (!normalizedFieldName) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), `${parameterName} is required for hybrid search.`, { itemIndex });
                        }
                        if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(normalizedFieldName)) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), `${parameterName} must be a valid field name or dotted field path.`, { itemIndex });
                        }
                        return `c.${normalizedFieldName}`;
                    };
                    const normalizedFieldsToReturn = normalizeOptionalSqlInput(fieldsToReturn);
                    const normalizedAdditionalFilters = normalizeOptionalSqlInput(additionalFilters);
                    const textFieldReference = buildDocumentFieldReference(hybridTextFieldName, 'Full Text Field Name');
                    const vectorFieldReference = buildDocumentFieldReference(hybridVectorFieldName, 'Vector Field Name');
                    const safeKeyword = escapeDoubleQuotes(keyword)
                        .trim()
                        .split(/\s+/)
                        .map((word) => `'${word}'`)
                        .join(',');
                    const safePartitionKeyValue = partitionKeyValue
                        ? escapeSingleQuotes(partitionKeyValue)
                        : '';
                    const embeddingLiteral = `[${embedding.join(',')}]`;
                    let selectClause = '*';
                    if (normalizedFieldsToReturn) {
                        const fields = normalizedFieldsToReturn
                            .split(',')
                            .map((field) => {
                            const trimmed = field.trim();
                            if (trimmed.startsWith('c.') || /\s+AS\s+/i.test(trimmed)) {
                                return trimmed;
                            }
                            return `c.${trimmed}`;
                        })
                            .join(', ');
                        selectClause = fields;
                    }
                    let whereClause = '';
                    const conditions = [];
                    if (partitionKeyValue) {
                        conditions.push(`c.${partitionKeyField}='${safePartitionKeyValue}'`);
                    }
                    if (normalizedAdditionalFilters) {
                        conditions.push(`(${normalizedAdditionalFilters})`);
                    }
                    if (conditions.length > 0) {
                        whereClause = ` WHERE ${conditions.join(' AND ')}`;
                    }
                    const rrfQuery = `SELECT TOP ${topK} ${selectClause} FROM c${whereClause} ORDER BY RANK RRF(FullTextScore(${textFieldReference}, ${safeKeyword}), VectorDistance(${vectorFieldReference}, ${embeddingLiteral}))`;
                    try {
                        const { resources } = await container.items.query(rrfQuery).fetchAll();
                        const internalFields = ['_rid', '_self', '_etag', '_attachments', '_ts'];
                        if (resources && resources.length > 0) {
                            const rerankedResources = await rerankDocuments(resources, reranker, searchQuery, hybridTextFieldName);
                            for (const resource of rerankedResources) {
                                let processedResource = resource;
                                if (simplifyOutput) {
                                    processedResource = { ...resource };
                                    for (const field of internalFields) {
                                        delete processedResource[field];
                                    }
                                }
                                if (excludeFields && fieldsToExclude) {
                                    const fieldsArray = fieldsToExclude
                                        .split(',')
                                        .map((f) => f.trim())
                                        .filter((f) => f.length > 0);
                                    processedResource = { ...processedResource };
                                    for (const field of fieldsArray) {
                                        delete processedResource[field];
                                    }
                                }
                                returnData.push({
                                    json: processedResource,
                                    pairedItem: itemIndex,
                                });
                            }
                        }
                        else {
                            returnData.push({
                                json: {
                                    message: 'No results found',
                                    keyword,
                                    searchQuery,
                                    topK,
                                    resultsCount: 0,
                                },
                                pairedItem: itemIndex,
                            });
                        }
                    }
                    catch (error) {
                        console.error('RRF Hybrid Search Error:', error);
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `RRF hybrid search failed: ${error.message}`, { itemIndex });
                    }
                }
                else if (operation === 'delete') {
                    const partitionKeyParam = this.getNodeParameter('partitionKey', itemIndex);
                    const partitionKey = typeof partitionKeyParam === 'string'
                        ? partitionKeyParam
                        : partitionKeyParam === null || partitionKeyParam === void 0 ? void 0 : partitionKeyParam.value;
                    const itemParam = this.getNodeParameter('item', itemIndex);
                    const id = typeof itemParam === 'string' ? itemParam : itemParam === null || itemParam === void 0 ? void 0 : itemParam.value;
                    if (!id) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Item ID is required for delete', {
                            itemIndex,
                        });
                    }
                    if (!partitionKey) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Partition key value is required for delete. Enter the exact partition key for this item.', { itemIndex });
                    }
                    const response = await container.item(id, partitionKey).delete();
                    returnData.push({
                        json: {
                            id,
                            partitionKey,
                            statusCode: response.statusCode,
                            deleted: response.statusCode >= 200 && response.statusCode < 300,
                        },
                        pairedItem: itemIndex,
                    });
                }
                else if (resource === 'container' && operation === 'getContainer') {
                    const dbName = this.getNodeParameter('databaseNameForContainer', itemIndex);
                    const contName = this.getNodeParameter('containerNameForContainer', itemIndex);
                    if (!dbName || !contName) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database and container are required to get container details', { itemIndex });
                    }
                    const db = client.database(dbName);
                    const cont = db.container(contName);
                    const { resource: contDef } = await cont.read();
                    const simplify = this.getNodeParameter('simplifyContainerOutput', itemIndex, true);
                    const output = simplify
                        ? {
                            id: contDef === null || contDef === void 0 ? void 0 : contDef.id,
                            partitionKeyPaths: (_e = contDef === null || contDef === void 0 ? void 0 : contDef.partitionKey) === null || _e === void 0 ? void 0 : _e.paths,
                            indexingMode: (_f = contDef === null || contDef === void 0 ? void 0 : contDef.indexingPolicy) === null || _f === void 0 ? void 0 : _f.indexingMode,
                        }
                        : contDef;
                    returnData.push({ json: output || { id: contName }, pairedItem: itemIndex });
                }
                else if (resource === 'container' && operation === 'deleteContainer') {
                    const dbName = this.getNodeParameter('databaseNameForContainer', itemIndex);
                    const contName = this.getNodeParameter('containerNameForContainer', itemIndex);
                    if (!dbName || !contName) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database and container are required to delete a container', { itemIndex });
                    }
                    const db = client.database(dbName);
                    const cont = db.container(contName);
                    const response = await cont.delete();
                    returnData.push({
                        json: {
                            id: contName,
                            statusCode: response.statusCode,
                            deleted: response.statusCode >= 200 && response.statusCode < 300,
                        },
                        pairedItem: itemIndex,
                    });
                }
                else if (resource === 'container' && operation === 'getManyContainers') {
                    const dbName = this.getNodeParameter('databaseNameForContainer', itemIndex);
                    const returnAll = this.getNodeParameter('containersReturnAll', itemIndex, true);
                    const limit = this.getNodeParameter('containersLimit', itemIndex, 50);
                    const simplify = this.getNodeParameter('simplifyContainerOutput', itemIndex, true);
                    if (!dbName) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database is required to list containers', { itemIndex });
                    }
                    const db = client.database(dbName);
                    const iterator = db.containers.readAll();
                    const { resources } = await iterator.fetchAll();
                    const list = returnAll ? resources : resources.slice(0, limit);
                    for (const c of list) {
                        const shaped = simplify
                            ? {
                                id: c.id,
                                partitionKeyPaths: (_g = c.partitionKey) === null || _g === void 0 ? void 0 : _g.paths,
                                indexingMode: (_h = c.indexingPolicy) === null || _h === void 0 ? void 0 : _h.indexingMode,
                            }
                            : c;
                        returnData.push({ json: shaped, pairedItem: itemIndex });
                    }
                }
                else if (resource === 'database' && operation === 'createDatabase') {
                    const newDbName = this.getNodeParameter('newDatabaseName', itemIndex).trim();
                    if (!newDbName) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database name is required', {
                            itemIndex,
                        });
                    }
                    if (newDbName.length > 255) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database name must be 1–255 characters long', { itemIndex });
                    }
                    if (!/^[A-Za-z0-9_-]+$/.test(newDbName)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database name can only contain letters, numbers, hyphens (-), and underscores (_).', { itemIndex });
                    }
                    const dbThroughput = this.getNodeParameter('dbThroughput', itemIndex, 0);
                    const createBody = { id: newDbName };
                    const createOptions = {};
                    if (dbThroughput > 0) {
                        createOptions.offerThroughput = dbThroughput;
                    }
                    const { resource: createdDb } = await client.databases.create(createBody, createOptions);
                    returnData.push({
                        json: createdDb || { id: newDbName },
                        pairedItem: itemIndex,
                    });
                }
                else if (resource === 'database' && operation === 'getDatabase') {
                    const dbId = this.getNodeParameter('databaseNameForDbOps', itemIndex);
                    if (!dbId) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database name is required to get database details', { itemIndex });
                    }
                    const { resource: dbDef } = await client.database(dbId).read();
                    const simplify = this.getNodeParameter('simplifyDatabaseOutput', itemIndex, true);
                    const output = simplify ? { id: dbDef === null || dbDef === void 0 ? void 0 : dbDef.id } : dbDef;
                    returnData.push({ json: output || { id: dbId }, pairedItem: itemIndex });
                }
                else if (resource === 'database' && operation === 'getManyDatabases') {
                    const returnAll = this.getNodeParameter('dbReturnAll', itemIndex, true);
                    const limit = this.getNodeParameter('dbLimit', itemIndex, 50);
                    const simplify = this.getNodeParameter('simplifyDatabaseOutput', itemIndex, true);
                    const { resources: allDbs } = await client.databases.readAll().fetchAll();
                    const dbList = returnAll ? allDbs : allDbs.slice(0, limit);
                    for (const db of dbList) {
                        const shaped = simplify ? { id: db.id } : db;
                        returnData.push({ json: shaped, pairedItem: itemIndex });
                    }
                }
                else if (resource === 'database' && operation === 'deleteDatabase') {
                    const dbId = this.getNodeParameter('databaseNameForDbOps', itemIndex);
                    if (!dbId) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Database name is required to delete a database', { itemIndex });
                    }
                    const response = await client.database(dbId).delete();
                    returnData.push({
                        json: {
                            id: dbId,
                            statusCode: response.statusCode,
                            deleted: response.statusCode >= 200 && response.statusCode < 300,
                        },
                        pairedItem: itemIndex,
                    });
                }
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error.message },
                        pairedItem: itemIndex,
                    });
                }
                else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                        itemIndex,
                    });
                }
            }
        }
        return [returnData];
    }
}
exports.CosmosDb = CosmosDb;
//# sourceMappingURL=CosmosDb.node.js.map