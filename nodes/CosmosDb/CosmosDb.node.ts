import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { CosmosClient } from '@azure/cosmos';

export class CosmosDb implements INodeType {
	description: INodeTypeDescription = {
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
			NodeConnectionTypes.Main,
			{
				displayName: 'Embedding',
				type: NodeConnectionTypes.AiEmbedding,
				required: false,
				maxConnections: 1,
			},
		],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'cosmosDbApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Item', value: 'item' },
					{ name: 'Container', value: 'container' },
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
						description:
							'Create a new record, or update the current one if it already exists (upsert)',
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
			// Operation selector for Container resource
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
				displayName: 'Database Name or ID',
				name: 'databaseName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDatabases',
				},
				default: '',
				placeholder: 'Select a database…',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
					loadOptionsDependsOn: ['databaseName'],
					loadOptionsMethod: 'getContainers',
				},
				default: '',
				placeholder: 'Select a container…',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: {
					show: {
						resource: ['item'],
					},
				},
			},
			// Delete operation fields
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
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
			// Set operation fields
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
				description:
					'Key/value pairs to set on the item. Use JSON Pointer paths like /status or /metadata/title. Values can be JSON (e.g. 123, true, {"a":1}) or plain text.',
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
								description:
									'Value to set. If this is valid JSON it will be parsed; otherwise it will be treated as a string.',
							},
						],
					},
				],
			},
			// Add operation fields
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
				description:
					'Key/value pairs to add to the item. Use JSON Pointer paths like /newField or /metadata/tag. Values can be JSON (e.g. 123, true, {"a":1}) or plain text.',
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
								description:
									'Value to add. If this is valid JSON it will be parsed; otherwise it will be treated as a string.',
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
				description:
					'Whether to exclude internal Cosmos DB fields (_rid, _self, _etag, _attachments, _ts)',
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
				description:
					'The JSON document to upsert. Must include an "ID" field and the partition key field defined in your container.',
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
				description:
					'Whether to add metadata key/value pairs that will be merged into document.metadata',
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
				description:
					'The text content to generate embedding for. You can use expressions to reference document fields.',
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
				description:
					'The text content to add to the document. You can use expressions to reference other fields.',
				displayOptions: {
					show: {
						resource: ['item'],
						operation: ['upsert'],
						addText: [true],
					},
				},
			},

			// Container resource: create container
			{
				displayName: 'Database Name or ID',
				name: 'databaseNameForCreate',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDatabases',
				},
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
			// Container resource: get/delete container
			{
				displayName: 'Database Name or ID',
				name: 'databaseNameForContainer',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDatabases',
				},
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
					loadOptionsDependsOn: ['databaseNameForContainer'],
					loadOptionsMethod: 'getContainersForContainerOps',
				},
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
			// Hybrid Search parameters
			{
				displayName: 'Keyword (Full Text Search)',
				name: 'keyword',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Enter full-text search keywords',
				description: 'Keywords for full-text search',
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
				required: true,
				placeholder: 'Enter semantic search query',
				description: 'Query text for vector embedding search (used in VectorDistance)',
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
				description:
					'Whether to exclude internal Cosmos DB fields (_rid, _self, _etag, _attachments, _ts)',
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('cosmosDbApi');
		const endpoint = credentials.endpoint as string;
		const key = credentials.key as string;

		const client = new CosmosClient({ endpoint, key });

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as 'item' | 'container';
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				// Resolve DB/container context for item resource operations (scoped per branch below for container resource)
				const databaseName =
					resource === 'item'
						? (this.getNodeParameter('databaseName', itemIndex) as string)
						: (this.getNodeParameter('databaseNameForCreate', itemIndex, '') as string);
				const containerName =
					resource === 'item' ? (this.getNodeParameter('containerName', itemIndex) as string) : '';

				const database = client.database(databaseName);
				const container = containerName ? database.container(containerName) : (undefined as any);

				if (resource === 'container' && operation === 'createContainer') {
					// Validate new container name
					const newContainerName = this.getNodeParameter('newContainerName', itemIndex) as string;
					const trimmedName = (newContainerName || '').trim();
					if (!trimmedName) {
						throw new NodeOperationError(this.getNode(), 'Container name is required', {
							itemIndex,
						});
					}
					// Enforce allowed characters and length (letters, numbers, hyphens, underscores)
					if (trimmedName.length > 255) {
						throw new NodeOperationError(
							this.getNode(),
							'Container name must be 1–255 characters long',
							{ itemIndex },
						);
					}
					if (!/^[A-Za-z0-9_-]+$/.test(trimmedName)) {
						throw new NodeOperationError(
							this.getNode(),
							'Container name can only contain letters, numbers, hyphens (-), and underscores (_).',
							{ itemIndex },
						);
					}

					let partitionKeyPath = this.getNodeParameter(
						'partitionKeyPath',
						itemIndex,
						'/category',
					) as string;
					partitionKeyPath = partitionKeyPath.startsWith('/')
						? partitionKeyPath
						: `/${partitionKeyPath}`;

					const addVectorPolicy = this.getNodeParameter(
						'addVectorPolicy',
						itemIndex,
						false,
					) as boolean;
					const addFullTextPolicy = this.getNodeParameter(
						'addFullTextPolicy',
						itemIndex,
						false,
					) as boolean;

					const containerDef: any = {
						id: trimmedName,
						partitionKey: { paths: [partitionKeyPath], kind: 'Hash' },
					};

					if (addVectorPolicy) {
						let vectorPath = this.getNodeParameter('vectorPath', itemIndex, '/vector') as string;
						vectorPath = vectorPath.startsWith('/') ? vectorPath : `/${vectorPath}`;
						const vectorDataType = this.getNodeParameter(
							'vectorDataType',
							itemIndex,
							'float32',
						) as string;
						const vectorDistanceFunction = this.getNodeParameter(
							'vectorDistanceFunction',
							itemIndex,
							'cosine',
						) as string;
						const vectorDimensions = this.getNodeParameter(
							'vectorDimensions',
							itemIndex,
							1536,
						) as number;
						const vectorIndexType = this.getNodeParameter(
							'vectorIndexType',
							itemIndex,
							'diskANN',
						) as string;

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
						let fullTextPath = this.getNodeParameter('fullTextPath', itemIndex, '/text') as string;
						fullTextPath = fullTextPath.startsWith('/') ? fullTextPath : `/${fullTextPath}`;
						containerDef.fullTextPolicy = {
							defaultLanguage: 'en-US',
							paths: [fullTextPath],
						};
					}

					const { resource: created } = await database.containers.create(containerDef);
					returnData.push({ json: (created as any) || { id: trimmedName }, pairedItem: itemIndex });
					continue;
				}

				if (operation === 'select') {
					// SELECT operation
					const sqlQuery = this.getNodeParameter('sqlQuery', itemIndex) as string;
					const returnAll = this.getNodeParameter('returnAll', itemIndex, true) as boolean;
					const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
					const simplifyOutput = this.getNodeParameter(
						'simplifyOutput',
						itemIndex,
						true,
					) as boolean;
					const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false) as boolean;
					const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '') as string;

					// Execute the SQL query
					const { resources } = await container.items.query(sqlQuery).fetchAll();

					// Define internal Cosmos DB fields to exclude when simplifying
					const internalFields = ['_rid', '_self', '_etag', '_attachments', '_ts'];

					// Apply limit if not returning all
					const resultSet = returnAll ? resources : resources.slice(0, limit);

					// Process each result
					for (const resource of resultSet) {
						let processedResource = resource;

						// Remove internal fields if simplify is enabled
						if (simplifyOutput) {
							processedResource = { ...resource };
							for (const field of internalFields) {
								delete processedResource[field];
							}
						}

						// Remove additional excluded fields if requested
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
				} else if (operation === 'set') {
					// SET operation (partial update using Cosmos DB patch)
					const partitionKeyParam = this.getNodeParameter('partitionKey', itemIndex) as
						| string
						| {
								mode: 'list' | 'value';
								value: any;
						  };
					const partitionKey =
						typeof partitionKeyParam === 'string' ? partitionKeyParam : partitionKeyParam?.value;
					const itemParam = this.getNodeParameter('item', itemIndex) as
						| string
						| {
								mode: 'list' | 'id';
								value: string;
						  };
					const id = typeof itemParam === 'string' ? itemParam : (itemParam?.value as string);

					if (!id) {
						throw new NodeOperationError(this.getNode(), 'Item ID is required for set', {
							itemIndex,
						});
					}
					if (partitionKey === undefined || partitionKey === null || partitionKey === '') {
						throw new NodeOperationError(
							this.getNode(),
							'Partition key value is required for set. Enter the exact partition key for this item.',
							{ itemIndex },
						);
					}

					const fieldsToSet = this.getNodeParameter('fieldsToSet', itemIndex, {}) as {
						pairs?: Array<{ path?: string; value?: string }>;
					};
					const pairs = fieldsToSet.pairs || [];
					if (!pairs.length) {
						throw new NodeOperationError(this.getNode(), 'Add at least one field to set', {
							itemIndex,
						});
					}

					const operations = pairs
						.filter((p) => p && typeof p.path === 'string' && p.path.trim() !== '')
						.map((p) => {
							const rawPath = (p.path || '').trim();
							const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
							const rawValue = (p.value ?? '').toString();
							let parsedValue: any = rawValue;
							try {
								parsedValue = JSON.parse(rawValue);
							} catch {
								parsedValue = rawValue;
							}
							return { op: 'set', path, value: parsedValue };
						});

					if (!operations.length) {
						throw new NodeOperationError(
							this.getNode(),
							'Fields to Set contains no valid paths. Provide at least one Field Path.',
							{ itemIndex },
						);
					}

					const response = await container.item(id, partitionKey as any).patch(operations as any);
					returnData.push({
						json: (response as any)?.resource || {
							id,
							partitionKey,
							statusCode: (response as any)?.statusCode,
							updated: (response as any)?.statusCode >= 200 && (response as any)?.statusCode < 300,
						},
						pairedItem: itemIndex,
					});
				} else if (operation === 'add') {
					// ADD operation (add new fields using Cosmos DB patch)
					const partitionKeyParam = this.getNodeParameter('partitionKey', itemIndex) as
						| string
						| {
								mode: 'list' | 'value';
								value: any;
						  };
					const partitionKey =
						typeof partitionKeyParam === 'string' ? partitionKeyParam : partitionKeyParam?.value;
					const itemParam = this.getNodeParameter('item', itemIndex) as
						| string
						| {
								mode: 'list' | 'id';
								value: string;
						  };
					const id = typeof itemParam === 'string' ? itemParam : (itemParam?.value as string);

					if (!id) {
						throw new NodeOperationError(this.getNode(), 'Item ID is required for add', {
							itemIndex,
						});
					}
					if (partitionKey === undefined || partitionKey === null || partitionKey === '') {
						throw new NodeOperationError(
							this.getNode(),
							'Partition key value is required for add. Enter the exact partition key for this item.',
							{ itemIndex },
						);
					}

					const fieldsToAdd = this.getNodeParameter('fieldsToAdd', itemIndex, {}) as {
						pairs?: Array<{ path?: string; value?: string }>;
					};
					const pairs = fieldsToAdd.pairs || [];
					if (!pairs.length) {
						throw new NodeOperationError(this.getNode(), 'Add at least one field to add', {
							itemIndex,
						});
					}

					const operations = pairs
						.filter((p) => p && typeof p.path === 'string' && p.path.trim() !== '')
						.map((p) => {
							const rawPath = (p.path || '').trim();
							const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
							const rawValue = (p.value ?? '').toString();
							let parsedValue: any = rawValue;
							try {
								parsedValue = JSON.parse(rawValue);
							} catch {
								parsedValue = rawValue;
							}
							return { op: 'add', path, value: parsedValue };
						});

					if (!operations.length) {
						throw new NodeOperationError(
							this.getNode(),
							'Fields to Add contains no valid paths. Provide at least one Field Path.',
							{ itemIndex },
						);
					}

					const response = await container.item(id, partitionKey as any).patch(operations as any);
					returnData.push({
						json: (response as any)?.resource || {
							id,
							partitionKey,
							statusCode: (response as any)?.statusCode,
							added: (response as any)?.statusCode >= 200 && (response as any)?.statusCode < 300,
						},
						pairedItem: itemIndex,
					});
				} else if (operation === 'upsert') {
					// Batch processing for upsert operations
					// First pass: prepare all documents and collect texts for batch embedding
					const documentsToProcess: Array<{
						document: any;
						itemIndex: number;
						addEmbedding: boolean;
						vectorFieldName?: string;
						textToEmbed?: string;
						addText: boolean;
						textFieldName?: string;
						textContent?: string;
					}> = [];

					// Collect all items that need processing
					for (let i = itemIndex; i < items.length; i++) {
						const currentOperation = this.getNodeParameter('operation', i) as string;
						if (currentOperation !== 'upsert') {
							break; // Stop if we hit a different operation
						}

						const documentJson = this.getNodeParameter('itemContent', i) as string;
						let document: any;
						try {
							document = typeof documentJson === 'string' ? JSON.parse(documentJson) : documentJson;
						} catch (error) {
							throw new NodeOperationError(this.getNode(), 'Invalid JSON in Document field', {
								itemIndex: i,
							});
						}

						// Merge metadata into document.metadata if requested
						const addMetadata = this.getNodeParameter('addMetadata', i, false) as boolean;
						if (addMetadata) {
							const metadataCollection = this.getNodeParameter('metadata', i, {}) as {
								pairs?: Array<{ key?: string; value?: any }>;
							};
							const pairs = metadataCollection.pairs || [];
							const metadataObj: Record<string, any> = {};
							for (const pair of pairs) {
								if (pair && pair.key) {
									metadataObj[pair.key] = pair.value;
								}
							}
							// Merge with existing metadata or create new metadata object
							document.metadata = { ...(document.metadata || {}), ...metadataObj };
						}

						const addEmbedding = this.getNodeParameter('addEmbedding', i, false) as boolean;
						const addText = this.getNodeParameter('addText', i, false) as boolean;

						documentsToProcess.push({
							document,
							itemIndex: i,
							addEmbedding,
							vectorFieldName: addEmbedding
								? (this.getNodeParameter('vectorFieldName', i) as string)
								: undefined,
							textToEmbed: addEmbedding
								? (this.getNodeParameter('textToEmbed', i) as string)
								: undefined,
							addText,
							textFieldName: addText
								? (this.getNodeParameter('textFieldName', i) as string)
								: undefined,
							textContent: addText
								? (this.getNodeParameter('textContent', i) as string)
								: undefined,
						});
					}

					// Batch embed all texts if needed
					const textsToEmbed = documentsToProcess
						.filter((item) => item.addEmbedding)
						.map((item) => item.textToEmbed!);

					let embeddings: number[][] = [];
					if (textsToEmbed.length > 0) {
						const aiData = (await this.getInputConnectionData(
							NodeConnectionTypes.AiEmbedding,
							0,
						)) as any;

						if (!aiData) {
							throw new NodeOperationError(
								this.getNode(),
								'No embedding model connected. Please connect an Embeddings node to the AI input.',
								{ itemIndex },
							);
						}

						// Use batch embedding if available (embedDocuments), otherwise fall back to individual embeddings
						if (typeof aiData.embedDocuments === 'function') {
							embeddings = await aiData.embedDocuments(textsToEmbed);
						} else if (typeof aiData.embedQuery === 'function') {
							// Fallback: embed one by one if batch method not available
							embeddings = await Promise.all(textsToEmbed.map((text) => aiData.embedQuery(text)));
						} else {
							throw new NodeOperationError(
								this.getNode(),
								'Embedding model does not support embedQuery or embedDocuments methods.',
								{ itemIndex },
							);
						}
					}

					// Second pass: add embeddings and text to documents, then upsert
					let embeddingIndex = 0;
					for (const item of documentsToProcess) {
						const { document, itemIndex: currentItemIndex } = item;

						// Add embedding if enabled
						if (item.addEmbedding && item.vectorFieldName) {
							document[item.vectorFieldName] = embeddings[embeddingIndex];
							embeddingIndex++;
						}

						// Add text if enabled
						if (item.addText && item.textFieldName) {
							document[item.textFieldName] = item.textContent;
						}

						// Get container properties to determine partition key path
						const containerDef = await container.read();
						const partitionKeyPath =
							containerDef.resource?.partitionKey?.paths?.[0]?.replace('/', '') || 'id';

						// Validate partition key field exists and has a non-empty value
						const hasPkField = Object.prototype.hasOwnProperty.call(document, partitionKeyPath);
						if (!hasPkField) {
							throw new NodeOperationError(
								this.getNode(),
								`Document must include the partition key field '${partitionKeyPath}'. Add this field to your document.`,
								{ itemIndex: currentItemIndex },
							);
						}

						const pkValue = (document as any)[partitionKeyPath];
						const isEmptyString = typeof pkValue === 'string' && pkValue.trim() === '';
						if (pkValue === undefined || pkValue === null || isEmptyString) {
							throw new NodeOperationError(
								this.getNode(),
								`Partition key '${partitionKeyPath}' must have a non-empty value when creating or updating an item.`,
								{ itemIndex: currentItemIndex },
							);
						}

						// Upsert the document (create or replace)
						const { resource } = await container.items.upsert(document);

						returnData.push({
							json: resource || document,
							pairedItem: currentItemIndex,
						});
					}

					// Skip ahead since we processed multiple items
					itemIndex += documentsToProcess.length - 1;
				} else if (operation === 'hybridSearch') {
					// HYBRID SEARCH operation - RRF combining full-text and vector search
					const keyword = this.getNodeParameter('keyword', itemIndex) as string;
					const searchQuery = this.getNodeParameter('searchQuery', itemIndex) as string;
					const topK = this.getNodeParameter('topK', itemIndex, 10) as number;
					const partitionKeyField = this.getNodeParameter(
						'partitionKeyField',
						itemIndex,
						'category',
					) as string;
					const partitionKeyValue = this.getNodeParameter(
						'partitionKeyValue',
						itemIndex,
						'',
					) as string;
					const additionalFilters = this.getNodeParameter(
						'additionalFilters',
						itemIndex,
						'',
					) as string;
					const fieldsToReturn = this.getNodeParameter(
						'fieldsToReturn',
						itemIndex,
						'',
					) as string;
					const simplifyOutput = this.getNodeParameter(
						'simplifyOutput',
						itemIndex,
						true,
					) as boolean;
					const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false) as boolean;
					const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '') as string;

					// Generate embedding from search query using AI embedding
					const aiData = (await this.getInputConnectionData(
						NodeConnectionTypes.AiEmbedding,
						0,
					)) as {
						embedQuery: (query: string) => Promise<number[]>;
					};
					if (!aiData || typeof aiData.embedQuery !== 'function') {
						throw new NodeOperationError(
							this.getNode(),
							'AI Embedding is required for hybrid search. Please connect an embeddings node to the Embedding input.',
							{ itemIndex },
						);
					}

					// Generate embedding for the search query
					const embedding = await aiData.embedQuery(searchQuery);

					// RRF Hybrid Search (Full-text + Vector) - Direct Cosmos SDK
					// Escape inputs to avoid breaking SQL
					const escapeDoubleQuotes = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
					const escapeSingleQuotes = (s: string) => s.replace(/'/g, "''");
					const safeKeyword = escapeDoubleQuotes(keyword)
						.trim()
						.split(/\s+/)
						.map((word) => `'${word}'`)
						.join(',');
					const safePartitionKeyValue = partitionKeyValue
						? escapeSingleQuotes(partitionKeyValue)
						: '';

					// Inline the embedding as a literal array in the SQL
					const embeddingLiteral = `[${embedding.join(',')}]`;

					// Build SELECT clause
					let selectClause = '*';
					if (fieldsToReturn && fieldsToReturn.trim()) {
						// Parse field names and add 'c.' prefix if not already present
						const fields = fieldsToReturn
							.split(',')
							.map((field) => {
								const trimmed = field.trim();
								// Check if already has 'c.' prefix or is using alias/function
								if (trimmed.startsWith('c.') || /\s+AS\s+/i.test(trimmed)) {
									return trimmed;
								}
								return `c.${trimmed}`;
							})
							.join(', ');
						selectClause = fields;
					}

					// Build WHERE clause combining partition key and additional filters
					let whereClause = '';
					const conditions: string[] = [];

					if (partitionKeyValue) {
						conditions.push(`c.${partitionKeyField}='${safePartitionKeyValue}'`);
					}

					if (additionalFilters && additionalFilters.trim()) {
						conditions.push(`(${additionalFilters.trim()})`);
					}

					if (conditions.length > 0) {
						whereClause = ` WHERE ${conditions.join(' AND ')}`;
					}

					// Build RRF hybrid search query with combined filters
					const rrfQuery = `SELECT TOP ${topK} ${selectClause} FROM c${whereClause} ORDER BY RANK RRF(FullTextScore(c.text, ${safeKeyword}), VectorDistance(c.vector, ${embeddingLiteral}))`;

					try {
						// Execute RRF query directly through Cosmos SDK
						const { resources } = await container.items.query(rrfQuery).fetchAll();

						// Define internal Cosmos DB fields to exclude when simplifying
						const internalFields = ['_rid', '_self', '_etag', '_attachments', '_ts'];

						if (resources && resources.length > 0) {
							// Process each result
							for (const resource of resources) {
								let processedResource = resource;

								// Remove internal fields if simplify is enabled
								if (simplifyOutput) {
									processedResource = { ...resource };
									for (const field of internalFields) {
										delete processedResource[field];
									}
								}

								// Remove additional excluded fields if requested
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
						} else {
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
					} catch (error) {
						console.error('RRF Hybrid Search Error:', error);
						throw new NodeOperationError(
							this.getNode(),
							`RRF hybrid search failed: ${error.message}`,
							{ itemIndex },
						);
					}
				} else if (operation === 'delete') {
					// DELETE operation
					const partitionKeyParam = this.getNodeParameter('partitionKey', itemIndex) as
						| string
						| {
								mode: 'list' | 'value';
								value: string;
						  };
					const partitionKey =
						typeof partitionKeyParam === 'string'
							? partitionKeyParam
							: (partitionKeyParam?.value as string);
					const itemParam = this.getNodeParameter('item', itemIndex) as
						| string
						| {
								mode: 'list' | 'id';
								value: string;
						  };
					const id = typeof itemParam === 'string' ? itemParam : (itemParam?.value as string);

					if (!id) {
						throw new NodeOperationError(this.getNode(), 'Item ID is required for delete', {
							itemIndex,
						});
					}
					if (!partitionKey) {
						throw new NodeOperationError(
							this.getNode(),
							'Partition key value is required for delete. Enter the exact partition key for this item.',
							{ itemIndex },
						);
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
				} else if (resource === 'container' && operation === 'getContainer') {
					// GET CONTAINER operation
					const dbName = this.getNodeParameter('databaseNameForContainer', itemIndex) as string;
					const contName = this.getNodeParameter('containerNameForContainer', itemIndex) as string;

					if (!dbName || !contName) {
						throw new NodeOperationError(
							this.getNode(),
							'Database and container are required to get container details',
							{ itemIndex },
						);
					}

					const db = client.database(dbName);
					const cont = db.container(contName);
					const { resource: contDef } = await cont.read();
					const simplify = this.getNodeParameter(
						'simplifyContainerOutput',
						itemIndex,
						true,
					) as boolean;
					const output = simplify
						? {
								id: contDef?.id,
								partitionKeyPaths: contDef?.partitionKey?.paths,
								indexingMode: contDef?.indexingPolicy?.indexingMode,
							}
						: contDef;
					returnData.push({ json: (output as any) || { id: contName }, pairedItem: itemIndex });
				} else if (resource === 'container' && operation === 'deleteContainer') {
					// DELETE CONTAINER operation
					const dbName = this.getNodeParameter('databaseNameForContainer', itemIndex) as string;
					const contName = this.getNodeParameter('containerNameForContainer', itemIndex) as string;

					if (!dbName || !contName) {
						throw new NodeOperationError(
							this.getNode(),
							'Database and container are required to delete a container',
							{ itemIndex },
						);
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
				} else if (resource === 'container' && operation === 'getManyContainers') {
					// GET MANY CONTAINERS operation
					const dbName = this.getNodeParameter('databaseNameForContainer', itemIndex) as string;
					const returnAll = this.getNodeParameter(
						'containersReturnAll',
						itemIndex,
						true,
					) as boolean;
					const limit = this.getNodeParameter('containersLimit', itemIndex, 50) as number;
					const simplify = this.getNodeParameter(
						'simplifyContainerOutput',
						itemIndex,
						true,
					) as boolean;

					if (!dbName) {
						throw new NodeOperationError(
							this.getNode(),
							'Database is required to list containers',
							{ itemIndex },
						);
					}

					const db = client.database(dbName);
					const iterator = db.containers.readAll();
					const { resources } = await iterator.fetchAll();
					const list = returnAll ? resources : resources.slice(0, limit);
					for (const c of list) {
						const shaped = simplify
							? {
									id: (c as any).id,
									partitionKeyPaths: (c as any).partitionKey?.paths,
									indexingMode: (c as any).indexingPolicy?.indexingMode,
								}
							: c;
						returnData.push({ json: shaped as any, pairedItem: itemIndex });
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						pairedItem: itemIndex,
					});
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return [returnData];
	}

	methods = {
		loadOptions: {
			async getDatabases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('cosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;

				const client = new CosmosClient({ endpoint, key });

				try {
					const { resources } = await client.databases.readAll().fetchAll();
					return resources.map((db: any) => ({
						name: db.id,
						value: db.id,
					}));
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to load databases: ${error.message}`,
					);
				}
			},

			async getContainers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('cosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;

				if (!databaseName) {
					return [];
				}

				const client = new CosmosClient({ endpoint, key });

				try {
					const database = client.database(databaseName);
					const { resources } = await database.containers.readAll().fetchAll();
					return resources.map((container: any) => ({
						name: container.id,
						value: container.id,
					}));
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to load containers: ${error.message}`,
					);
				}
			},

			async getContainersForContainerOps(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('cosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;
				const databaseName = this.getCurrentNodeParameter('databaseNameForContainer') as string;

				if (!databaseName) {
					return [];
				}

				const client = new CosmosClient({ endpoint, key });

				try {
					const database = client.database(databaseName);
					const { resources } = await database.containers.readAll().fetchAll();
					return resources.map((container: any) => ({
						name: container.id,
						value: container.id,
					}));
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to load containers: ${error.message}`,
					);
				}
			},

			async getItemIds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('cosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;
				const containerName = this.getCurrentNodeParameter('containerName') as string;

				if (!databaseName || !containerName) {
					return [];
				}

				const client = new CosmosClient({ endpoint, key });
				try {
					const container = client.database(databaseName).container(containerName);
					// Limit to first 200 IDs to keep dropdown responsive
					const query = {
						query: 'SELECT c.id FROM c',
					};
					const { resources } = await container.items
						.query(query, { maxItemCount: 200 })
						.fetchAll();
					return resources
						.map((r: any) => r.id)
						.filter((id: any) => typeof id === 'string')
						.slice(0, 200)
						.map((id: string) => ({ name: id, value: id }));
				} catch (error) {
					throw new NodeOperationError(this.getNode(), `Failed to load item IDs: ${error.message}`);
				}
			},

			// For resource locator list mode with search support
			async searchItemIds(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('cosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;
				const containerName = this.getCurrentNodeParameter('containerName') as string;

				if (!databaseName || !containerName) return [];

				const client = new CosmosClient({ endpoint, key });
				try {
					const container = client.database(databaseName).container(containerName);
					const querySpec = { query: 'SELECT c.id FROM c' };
					const { resources } = await container.items
						.query(querySpec, { maxItemCount: 200 })
						.fetchAll();
					const ids = resources
						.map((r: any) => r.id)
						.filter((id: any) => typeof id === 'string') as string[];
					const normalizedFilter = (filter || '').toLowerCase();
					return ids
						.filter((id) => !normalizedFilter || id.toLowerCase().includes(normalizedFilter))
						.slice(0, 200)
						.map((id) => ({ name: id, value: id }));
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to search item IDs: ${error.message}`,
					);
				}
			},
		},
		listSearch: {
			async searchItemIds(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const credentials = await this.getCredentials('cosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;
				const containerName = this.getCurrentNodeParameter('containerName') as string;

				if (!databaseName || !containerName) return { results: [] };

				const client = new CosmosClient({ endpoint, key });
				try {
					const container = client.database(databaseName).container(containerName);
					const query = { query: 'SELECT VALUE c.id FROM c' };
					const { resources } = await container.items
						.query(query, { maxItemCount: 200 })
						.fetchAll();
					const ids = (resources as any[]).filter((v) => typeof v === 'string') as string[];
					const f = (filter || '').toLowerCase();
					return {
						results: ids
							.filter((id) => !f || id.toLowerCase().includes(f))
							.slice(0, 200)
							.map((id) => ({ name: id, value: id })),
					};
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to search item IDs: ${error.message}`,
					);
				}
			},

			async searchPartitionKeys(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const credentials = await this.getCredentials('cosmosDbApi');
				const endpoint = credentials.endpoint as string;
				const key = credentials.key as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;
				const containerName = this.getCurrentNodeParameter('containerName') as string;

				if (!databaseName || !containerName) return { results: [] };

				const client = new CosmosClient({ endpoint, key });
				try {
					const container = client.database(databaseName).container(containerName);
					const def = await container.read();
					const pkPathRaw = def.resource?.partitionKey?.paths?.[0] || '/id';
					const pkField = pkPathRaw.replace('/', '');
					const query = {
						query: `SELECT DISTINCT VALUE c.${pkField} FROM c WHERE IS_DEFINED(c.${pkField})`,
					};
					const { resources } = await container.items
						.query(query, { maxItemCount: 200 })
						.fetchAll();
					const values = (resources as any[]).filter(
						(v) => typeof v === 'string' || typeof v === 'number',
					) as Array<string | number>;
					const f = (filter || '').toLowerCase();
					return {
						results: values
							.map((v) => ({ name: String(v), value: v }))
							.filter((kv) => !f || kv.name.toLowerCase().includes(f))
							.slice(0, 200),
					};
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to search partition keys: ${error.message}`,
					);
				}
			},
		},
	};
}
