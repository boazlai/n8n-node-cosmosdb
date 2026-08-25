# Custom Vector Store / AI Tool Node for n8n — Engineering Notes

> **Status**: Bug fixed and deployed (April 2026). This document captures root-cause analysis and implementation patterns for building custom nodes that live on n8n's AI tool bus (ai_tool, ai_embedding, ai_memory connections).

---

## 1. What This Node Does

`CosmosDbHybridSearchTool` is a custom n8n node that:

- Lives **entirely on the AI tool bus** — no main data-flow connections
- Registers itself as a `DynamicTool` for an AI Agent via `supplyData()`
- Takes **two AI sub-node inputs**: an embedding model (`AiEmbedding`, required) and a reranker (`AiReranker`, optional)
- Emits a single **`AiTool` output** to connect to an AI Agent node
- At runtime, embeds the agent's query, runs a hybrid RRF (vector + full-text) SQL query against Azure Cosmos DB, optionally re-ranks, and returns results as JSON

---

## 2. The Critical Bug and Root Cause

### Symptom
`execute()` was being called with this error:
```
Error: Cosmos DB Hybrid Search Tool only supports the AI tool bus.
  at ExecuteContext.execute (...CosmosDbHybridSearchTool.node.ts:639:9)
  at WorkflowExecute.executeNode (...workflow-execute.ts:1043:31)
  at WorkflowExecute.runNode (...workflow-execute.ts:1222:22)
```

### Root Cause — n8n's Partial Execution Engine

When the user clicks **"Execute workflow"** (partial/manual run), n8n uses `runPartialWorkflow2()`:

1. Builds a `DirectedGraph.fromWorkflow()` — this includes **ALL connection types**: `main`, `ai_tool`, `ai_embedding`, `ai_memory`, `ai_reranker`, etc.
2. Finds "dirty" nodes (no existing run data) — our Cosmos DB node qualifies
3. `recreateNodeExecutionStack` sees it has **no incoming `main` connections** → pushes it onto the `nodeExecutionStack` with empty data: `{ main: [{ json: {} }] }`
4. `runNode()` checks: **if `nodeType.execute` is defined → calls `executeNode()` → calls `execute()`**

So any custom AI sub-node with a defined `execute()` method **will have `execute()` called from the main execution stack**, even if the node is only meant to work via `supplyData()`.

### The Fix

**Do NOT throw in `execute()`.** Return `[[]]` instead:

```typescript
async execute(): Promise<INodeExecutionData[][]> {
    // n8n's partial workflow runner adds AI sub-nodes to the execution stack
    // because they have no incoming Main connections. Return empty gracefully.
    // Real work happens via supplyData() when the AI Agent invokes the tool.
    return [[]];
}
```

**Why not remove `execute()` entirely?**  
`runNode()` also throws if a node has `supplyData` but no `execute`:
```javascript
if (nodeType.supplyData) {
    throw new ApplicationError(`The node "${node.type}" has a "supplyData" method but no "execute" method.`)
}
```
Both methods must be present. `execute()` must return gracefully.

---

## 3. Native Vector Store Pattern (from `@n8n/ai-utilities`)

Native n8n nodes like Pinecone, Supabase, Zep use a `createVectorStoreNode` factory. Key differences vs a hand-rolled node:

| Aspect | Native Vector Store | Our Custom Node |
|--------|--------------------|----|
| `execute()` | Works — reads `item.json.input`, runs actual search | Returns `[[]]` gracefully |
| `supplyData()` | Uses `createToolFromNode` + `logWrapper` | Raw `DynamicTool` |
| Reranker access in tool | **Lazy** — fetched inside the tool callback | Eager — fetched at `supplyData()` setup |
| `inputs` / `outputs` | Dynamic expression strings (JS template literals) | Static arrays |
| Mode awareness | Has `operationModes` + a `mode` parameter | Single-mode (tool only) |

### Native `execute()` Pattern (for reference)

Native nodes implement `execute()` to handle the `retrieve-as-tool` mode when called from the main stack:

```javascript
// Inside native execute():
const items = this.getInputData(0);
for (let i = 0; i < items.length; i++) {
    const query = items[i].json.input; // query comes from item.json.input
    if (!query) throw new Error('Input data must contain an "input" field');
    const embeddings = await this.getInputConnectionData(NodeConnectionTypes.AiEmbedding, 0);
    // ... run search, push to returnData
}
return [returnData];
```

This is useful if you want the node to also work in a pure data-flow (non-agent) context.

---

## 4. Node Structure Requirements

### Minimal Interface for an AI Tool Node

```typescript
export class MySearchTool implements INodeType {
    description: INodeTypeDescription = {
        // ...
        // Static inputs: declare your sub-node dependencies
        inputs: [
            { displayName: 'Embeddings', type: NodeConnectionTypes.AiEmbedding, required: true, maxConnections: 1 },
            { displayName: 'Reranker',   type: NodeConnectionTypes.AiReranker,  required: false, maxConnections: 1 },
        ],
        // Single AiTool output — connects to AI Agent
        outputs: [NodeConnectionTypes.AiTool],
        // ...
    };

    // ✅ REQUIRED: Called by AI Agent to register the tool
    async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
        // Get embedding model at setup time
        const embeddings = await this.getInputConnectionData(NodeConnectionTypes.AiEmbedding, 0) as IEmbeddingModel;
        // NOTE: For reranker, consider fetching LAZILY inside the tool func (see Section 5)

        const tool = new DynamicTool({
            name: nodeNameToToolName(this.getNode().name),
            description: '...',
            func: async (input: string): Promise<string> => {
                // embed → search → rerank → return JSON string
            },
        });
        return { response: tool };
    }

    // ✅ REQUIRED: Must exist alongside supplyData — return [[]] when called from main stack
    async execute(): Promise<INodeExecutionData[][]> {
        return [[]];
    }
}
```

### Tracking Execution Data

Inside `supplyData()`, use these to wire up n8n's execution data panel:

```typescript
// At the start of supplyData():
const index = this.addInputData(NodeConnectionTypes.AiTool, [[{ json: { query: input } }]])[0];

// At the end (success):
this.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { response } }]]);

// On error:
this.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { error: message } }]]);
```

---

## 5. Lazy vs Eager Sub-Node Access

### Problem with Eager Reranker Access

If you fetch the reranker at `supplyData()` setup time:
```typescript
// ⚠️ Eager — called once at setup, before any query
const reranker = await this.getInputConnectionData(NodeConnectionTypes.AiReranker, 0);
```
This may work but it binds the reranker to the execution context at setup time rather than per-invocation.

### Native Pattern: Lazy Reranker Access

Native nodes fetch retrievers/rerankers **inside the tool callback**, lazily:
```typescript
func: async (input: string) => {
    // ✅ Lazy — evaluated per tool invocation
    const reranker = await context.getInputConnectionData(NodeConnectionTypes.AiReranker, 0);
    // ...
}
```
Note: you must capture `context = this` before the `DynamicTool` constructor since `this` changes inside `func`.

---

## 6. Node Registration

### `n8nNodes` in `package.json`
```json
{
  "n8n": {
    "nodes": [
      "dist/nodes/CosmosDb/CosmosDbHybridSearchTool.node.js"
    ]
  }
}
```

### Community Package Registration in n8n

n8n's `getByNameAndVersion()` handles tool nodes specially:

```javascript
getByNameAndVersion(nodeType, version) {
    const toolRequested = nodeType.endsWith('Tool');
    if (toolRequested && this.loadNodesAndCredentials.recognizesNode(nodeType)) {
        // ✅ Our node: returns it directly WITH supplyData intact
        return NodeHelpers.getVersionedNodeType(node.type, version);
    }
    if (toolRequested) {
        // For non-community nodes ending in "Tool": strips "Tool" suffix,
        // looks up base node, then checks if it has supplyData → throws if it does
        nodeType = nodeType.replace(/Tool$/, '');
        // ...
        if (typeof versionedNodeType.supplyData === 'function') {
            throw new UnexpectedError('Node already has a `supplyData` method');
        }
    }
}
```

**Key takeaway**: Name your community node with a `Tool` suffix (e.g., `cosmosDbHybridSearchTool`) so `recognizesNode()` returns `true` and the node is returned directly with `supplyData()` preserved.

---

## 7. Build and Deploy Workflow

```bash
# 1. Build TypeScript
cd /home/boaz_lai/prj/Hku-CosmosDB && npm run build

# 2. Deploy only the changed file to Docker
docker cp dist/nodes/CosmosDb/CosmosDbHybridSearchTool.node.js \
    n8n:/home/node/.n8n/custom/node_modules/n8n-nodes-cosmosdb/dist/nodes/CosmosDb/CosmosDbHybridSearchTool.node.js

# 3. Restart n8n
cd /home/boaz_lai/prj/n8n && docker compose -f docker-compose.yml restart n8n

# 4. Verify clean startup (no execute/supplyData errors for our node)
docker logs n8n --since 1m 2>&1 | grep -E "ready|Error|cosmosDb"
```

Node path in Docker: `/home/node/.n8n/custom/node_modules/n8n-nodes-cosmosdb/`

---

## 8. Workflow Configuration

**Workflow ID**: `vn3HetWbAE8RsNEu` ("My workflow 3")

Node connections in n8n:
```
Manual Trigger → Edit Fields → AI Agent
                               ↑ (ai_languageModel) OpenAI Chat Model
                               ↑ (ai_tool)          Cosmos DB Hybrid Search
                                                      ↑ (ai_embedding) Embeddings OpenAI
                                                      ↑ (ai_reranker)  [optional]
```

The `ai_tool` + `ai_embedding` connections are shown in n8n as sub-connections directly on the AI Agent and Cosmos DB Hybrid Search nodes respectively.

---

## 9. Debugging Tips

### API Key
```bash
N8N_KEY2="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Check Recent Executions
```bash
curl -s "http://localhost:5678/api/v1/executions?workflowId=vn3HetWbAE8RsNEu&limit=5" \
  -H "X-N8N-API-KEY: $N8N_KEY2" | python3 -c "
import sys,json
for e in json.load(sys.stdin).get('data',[]): print(e['id'], e['status'], e['startedAt'])
"
```

### Get Full Error from a Failed Execution
```bash
curl -s "http://localhost:5678/api/v1/executions/<ID>?includeData=true" \
  -H "X-N8N-API-KEY: $N8N_KEY2" | python3 -c "
import sys,json
e=json.load(sys.stdin)
err = e.get('data',{}).get('resultData',{}).get('error',{})
print('Error:', err.get('message',''))
print('Stack:', err.get('stack','')[:1000])
"
```

### Verify Compiled Output
```bash
docker exec n8n grep -n "execute\|return \[\[\]\]\|supplyData" \
  /home/node/.n8n/custom/node_modules/n8n-nodes-cosmosdb/dist/nodes/CosmosDb/CosmosDbHybridSearchTool.node.js | tail -10
```

---

## 10. Common Errors Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `execute() throws "only supports AI tool bus"` | `execute()` called by n8n's partial execution engine | Change `execute()` to return `[[]]` |
| `Node already has a supplyData method` | `getByNameAndVersion` strips "Tool" from name, finds a node that also has `supplyData` | Ensure your node name is recognized by `recognizesNode()` (community package must be installed) |
| `The node "X" has a supplyData method but no execute method` | `execute()` removed entirely | Keep `execute()` returning `[[]]` |
| Embedding `undefined` error | `getInputConnectionData` called on wrong index or connection not wired | Verify `AiEmbedding` connection is drawn in the workflow |
| Tool never invoked | `supplyData()` not returning a proper `DynamicTool` with correct `name` | Use `nodeNameToToolName(this.getNode().name)` for the tool name |
