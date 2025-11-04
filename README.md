# Cosmos DB Custom Node for n8n

A custom n8n node for interacting with Azure Cosmos DB, featuring vector search capabilities, AI embedding integration, and hybrid search using Reciprocal Rank Fusion (RRF).

## Overview

This custom node provides three main operations for working with Azure Cosmos DB:

1. **Select** - Query documents using SQL
2. **Create or Update** - Upsert documents with optional embeddings and metadata
3. **Hybrid Search** - Advanced search combining full-text and vector similarity using RRF

## Architecture

### Core Components

#### 1. Credentials (`HkuCosmosDbCredentialsApi.credentials.ts`)

Manages Azure Cosmos DB connection credentials:

- **Endpoint**: Your Cosmos DB account URI
- **Key**: Primary or secondary key for authentication

#### 2. Main Node (`HkuCosmosDbNode.node.ts`)

The primary node implementation with the following structure:

**Inputs:**

- **Main Input**: Standard n8n workflow data
- **Embedding Input** (Optional): Connection to an AI embedding model (OpenAI, Azure OpenAI, etc.)

**Outputs:**

- **Main Output**: Query results or operation confirmations

### How It Works

## Operation 1: Select

Executes SQL queries against your Cosmos DB container.

### Key Features:

- **SQL Query**: Write custom SQL queries to retrieve documents
- **Result Limiting**: Option to return all results or limit to a specific number
- **Simplify Output**: Automatically removes Cosmos DB internal fields (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`)
- **Exclude Fields**: Custom field exclusion to reduce payload size

### Code Flow:

```typescript
1. Parse SQL query from parameters
2. Connect to Cosmos DB using SDK client
3. Execute query: container.items.query(sqlQuery).fetchAll()
4. Process results:
   - Remove internal fields if simplifyOutput enabled
   - Remove custom fields if excludeFields enabled
5. Return processed documents
```

### Example Use Case:

```sql
SELECT * FROM c WHERE c.category = 'research' ORDER BY c._ts DESC
```

---

## Operation 2: Create or Update (Upsert)

Inserts or updates documents in Cosmos DB with intelligent field additions.

### Key Features:

- **JSON Document Input**: Accepts JSON documents with required `id` and partition key fields
- **Add Embedding**: Automatically generate and add vector embeddings using connected AI model
- **Add Text**: Add text content to a specified field
- **Add Metadata**: Merge custom metadata into the document

### Code Flow:

```typescript
1. Parse JSON document from input
2. Validate document structure (id field required)

3. IF "Add Embedding" enabled:
   - Get text content to embed
   - Connect to AI embedding model via NodeConnectionTypes.AiEmbedding
   - Generate embedding: await aiData.embedQuery(textToEmbed)
   - Add vector to document: document[vectorFieldName] = embedding

4. IF "Add Text" enabled:
   - Get text content from parameters
   - Add to document: document[textFieldName] = textContent

5. IF "Add Metadata" enabled:
   - Parse metadata key-value pairs
   - Merge into document.metadata object

6. Validate partition key field exists
7. Execute upsert: container.items.upsert(document)
8. Return created/updated document
```

### Why This Matters:

- **Embeddings**: Enables vector similarity search by converting text to high-dimensional vectors
- **Text Field**: Stores original text alongside embeddings for retrieval and display
- **Metadata**: Adds structured metadata without modifying main document structure

### Example Workflow:

```
Input Document:
{
  "id": "doc-123",
  "category": "AI",
  "title": "Machine Learning Basics"
}

With "Add Text" enabled (field: "text", content: "Introduction to ML"):
With "Add Embedding" enabled (field: "vector", text: "Introduction to ML"):

Output Document:
{
  "id": "doc-123",
  "category": "AI",
  "title": "Machine Learning Basics",
  "text": "Introduction to ML",
  "vector": [0.123, -0.456, 0.789, ...] // 1536-dimensional vector
}
```

---

## Operation 3: Hybrid Search

Advanced search combining full-text search and vector similarity using Reciprocal Rank Fusion (RRF).

### What is RRF?

Reciprocal Rank Fusion is a technique that combines multiple ranking signals:

- **Full-Text Search**: Traditional keyword matching using `FullTextScore()`
- **Vector Search**: Semantic similarity using `VectorDistance()`

RRF formula: `RRF_score = 1/(k + rank)` for each ranking method, then sum the scores.

### Key Features:

- **Keyword Search**: Full-text search on indexed text fields
- **Semantic Search**: Vector similarity search using AI embeddings
- **Top K Results**: Control number of results returned
- **Partition Key Filtering**: Optional filtering by partition key
- **Simplify/Exclude Fields**: Control output format

### Code Flow:

```typescript
1. Get search parameters (keyword, searchQuery, topK)

2. Connect to AI embedding model
   - Validate connection exists
   - Generate embedding for search query: await aiData.embedQuery(searchQuery)

3. Build RRF SQL query:
   - Escape special characters in keyword
   - Convert embedding array to SQL literal: [0.1, 0.2, ...]
   - Construct query:
     SELECT TOP ${topK} * FROM c
     ORDER BY RANK RRF(
       FullTextScore(c.text, '${keywords}'),
       VectorDistance(c.vector, ${embeddingArray})
     )

4. Add partition key filter if specified:
   WHERE c.${partitionKeyField} = '${partitionKeyValue}'

5. Execute query via Cosmos SDK: container.items.query(rrfQuery).fetchAll()

6. Process results:
   - Remove internal fields if simplifyOutput enabled
   - Remove custom fields if excludeFields enabled

7. Return ranked results
```

### Why Direct SQL Execution?

Previously, this node used Azure Functions to execute RRF queries. Now it uses **inline SQL with embedding literals**:

**Advantages:**

- ✅ No external dependencies (no Function App needed)
- ✅ Lower latency (direct SDK call)
- ✅ Reduced costs (no Function App hosting)
- ✅ Simpler architecture

**How It Works:**
The embedding vector is directly embedded in the SQL query as an array literal:

```sql
SELECT TOP 10 * FROM c
ORDER BY RANK RRF(
  FullTextScore(c.text, 'machine learning'),
  VectorDistance(c.vector, [0.123, -0.456, 0.789, ...])
)
```

### Example Search:

```
Keyword: "machine learning"
Search Query: "What is neural network?"
Top K: 10

Result: Documents ranked by combined relevance of:
1. Keyword match with "machine learning"
2. Semantic similarity to "What is neural network?"
```

---

## AI Agent Tool Integration

This node is designed to work as an **AI Agent Tool** in n8n workflows.

### Key Implementation Details:

#### Static vs Dynamic Inputs

```typescript
// ✅ CORRECT - Static inputs (works as tool)
inputs: [
	NodeConnectionTypes.Main,
	{
		displayName: 'Embedding',
		type: NodeConnectionTypes.AiEmbedding,
		required: false,
		maxConnections: 1,
	},
];

// ❌ WRONG - Dynamic inputs (breaks tool registration)
inputs: `={{...}}`; // Template expressions don't work for tools
```

**Why Static?**

- AI Agent tools are registered at startup, not runtime
- n8n needs to know connection types before workflow execution
- Static inputs with `required: false` provide flexibility

#### Connection Retrieval

```typescript
// Correct way to get embedding connection
const aiData = (await this.getInputConnectionData(NodeConnectionTypes.AiEmbedding, 0)) as {
	embedQuery: (query: string) => Promise<number[]>;
};
```

#### Tool Enablement

```typescript
usableAsTool: true, // Enables node as AI Agent tool
```

### Workflow Example:

```
AI Agent → HKU Cosmos DB (Tool) → Connected Embedding Model
         ↓
    User Query
         ↓
Agent decides to search knowledge base
         ↓
Calls HKU Cosmos DB hybrid search with query
         ↓
Embedding model generates vector
         ↓
RRF search executed
         ↓
Results returned to Agent
         ↓
Agent formulates response
```

---

## Technical Details

### Dependencies

```json
{
	"@azure/cosmos": "^4.x",
	"n8n-workflow": "^1.x"
}
```

### Connection Types

- `NodeConnectionTypes.Main`: Standard workflow data flow
- `NodeConnectionTypes.AiEmbedding`: AI embedding model connections (OpenAI, Azure OpenAI, etc.)
- `NodeConnectionTypes.AiTool`: Enables use as AI Agent tool

### Error Handling

The node implements comprehensive error handling:

- **Invalid JSON**: Validates document parsing in upsert operation
- **Missing ID**: Ensures documents have required `id` field
- **Missing Partition Key**: Validates partition key field exists
- **No Embedding Model**: Checks for connected embedding model when required
- **SQL Injection Protection**: Escapes special characters in queries

### Input Sanitization

```typescript
// Double quote escaping for FullTextScore
const escapeDoubleQuotes = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Single quote escaping for partition key values
const escapeSingleQuotes = (s: string) => s.replace(/'/g, "''");
```

---

## Installation

1. Clone this repository to your n8n custom nodes directory:

```bash
~/.n8n/custom/
```

2. Install dependencies:

```bash
cd ~/.n8n/custom/n8n-custom-hkunode
npm install
```

3. Restart n8n:

```bash
n8n start
```

4. The node will appear in the n8n editor under "HKU Cosmos DB"

---

## Configuration

### 1. Set Up Credentials

- Navigate to Credentials in n8n
- Create new "HKU Cosmos DB API" credential
- Enter your Cosmos DB endpoint and key

### 2. Create Container with Vector Index

Your Cosmos DB container should have:

- **Full-text index** on text fields (for keyword search)
- **Vector index** on embedding fields (for semantic search)

Example index policy:

```json
{
	"indexingMode": "consistent",
	"automatic": true,
	"includedPaths": [{ "path": "/*" }],
	"vectorIndexes": [
		{
			"path": "/vector",
			"type": "quantizedFlat"
		}
	]
}
```

### 3. Connect Embedding Model

- Add an Embeddings node (OpenAI Embeddings, Azure OpenAI Embeddings, etc.)
- Connect it to the "Embedding" input of HKU Cosmos DB node
- Works for both Upsert and Hybrid Search operations

---

## Use Cases

### 1. **Knowledge Base Search**

- Store documents with text and embeddings
- Use hybrid search to find relevant information
- Combine with AI Agent for conversational search

### 2. **Document Management**

- Upsert documents with automatic embedding generation
- Query documents using SQL
- Maintain metadata alongside content

### 3. **Semantic Search Application**

- Index content with embeddings
- Enable natural language search
- Rank results by relevance (RRF)

### 4. **AI Agent Tool**

- Provide knowledge base access to AI agents
- Enable agents to search and retrieve information
- Combine multiple data sources in agent workflows

---

## Troubleshooting

### "No embedding model connected" Error

**Solution**: Connect an Embeddings node to the "Embedding" input

### "Document must include partition key field" Error

**Solution**: Ensure your document includes the partition key field defined in your container

### "Invalid JSON in Document field" Error

**Solution**: Validate your JSON syntax in the Item Content field

### Tool Not Appearing in AI Agent

**Solution**: Ensure `usableAsTool: true` is set and inputs are defined as static array (not dynamic template)

---

## Development Notes

### File Structure

```
Hku-CosmosDB/
├── credentials/
│   └── HkuCosmosDbCredentialsApi.credentials.ts
├── nodes/
│   └── HkuCosmosDbNode/
│       └── HkuCosmosDbNode.node.ts
├── package.json
└── README.md
```

### Key Design Decisions

1. **Static Inputs**: Required for AI Agent tool compatibility
2. **Optional Embedding Input**: Allows flexibility across operations
3. **Direct SQL Execution**: Eliminates Azure Function dependency
4. **RRF Implementation**: Combines full-text and vector search effectively
5. **Field Simplification**: Reduces noise in output data

---

## Future Enhancements

Potential improvements:

- [ ] Batch operations support
- [ ] Custom RRF weighting parameters
- [ ] Multiple vector field support
- [ ] Query result caching
- [ ] Streaming results for large datasets

---

## License

[Your License Here]

## Contributing

Contributions are welcome! Please submit issues and pull requests.

## Support

For questions or issues, please open a GitHub issue.
