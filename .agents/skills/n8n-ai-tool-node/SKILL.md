---
name: n8n-ai-tool-node
description: 'Build a working n8n community node that plugs into the AI tool bus (supplyData + AiTool output), with sub-inputs for AiEmbedding and AiReranker. Use when creating a custom vector store, hybrid search, or RAG tool node for n8n AI Agents. Covers the two-phase invocation architecture, DynamicStructuredTool schema contract, execute() dual-role pattern, and replacements for native utilities unavailable to community nodes (logWrapper, createToolFromNode, Zod cross-instance issues).'
argument-hint: 'Describe the data source (e.g. "Cosmos DB hybrid search", "Qdrant vector store")'
---

# n8n Community AI Tool Node (Vector Store / Hybrid Search)

## When to Use
- Creating a custom n8n node that the AI Agent can call as a tool
- The tool needs to embed a query (AiEmbedding), search a database, and return results
- Optionally rerank results (AiReranker)
- You want it to behave exactly like native nodes (Pinecone, Supabase, MongoDB Atlas)

---

## Critical Architecture: Two-Phase Invocation

**Read this before writing a single line of code.**

n8n calls your node in two completely separate phases:

```
Phase 1 — SETUP (once, when AI Agent initialises):
  getInputConnectionData('AiTool', itemIndex)
    → calls supplyData(this, itemIndex)
    → you return { response: DynamicStructuredTool }
    → tool registered in agent's tool list

Phase 2 — RUNTIME (every time agent decides to call your tool):
  makeHandleToolInvocation(...)
    → calls execute(this)
    → query arrives in:  this.getInputData()[0].json.input
    → execute() MUST embed query, call DB, return [[{ json: { output: "..." } }]]
```

**`supplyData.func` is never called by the LangChain agent at runtime.**
The agent goes through n8n's `makeHandleToolInvocation` → `execute()` path. The `func` you write in `supplyData` covers only the rare case where something calls it directly (e.g. streaming or future n8n paths) — treat it as dead code for the main flow.

---

## Step-by-Step Procedure

### Step 1 — Node description boilerplate

Set outputs and inputs exactly:

```typescript
outputs: [NodeConnectionTypes.AiTool],
inputs: [
    { displayName: 'Embeddings', type: NodeConnectionTypes.AiEmbedding, required: true, maxConnections: 1 },
    { displayName: 'Reranker',   type: NodeConnectionTypes.AiReranker,  required: false, maxConnections: 1 },
],
```

Add `usableAsTool: true` in the description if you want the native "use as tool" toggle.

### Step 2 — `execute()`: the dual-role method (MOST CRITICAL)

`execute()` is called in two contexts. Detect which context you're in by checking for a non-empty `input` field:

```typescript
async execute(): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const query = ((items[0]?.json?.input as string) || '').trim();

    if (!query) {
        // Context A: partial workflow run / setup — synthetic empty data
        // Must return gracefully, NOT throw
        return [[]];
    }

    // Context B: runtime tool invocation by the AI Agent
    // query = the agent's plain-text question
    // ... do real work here ...
    return [[{ json: { output: resultString } }]];
}
```

> ⚠️ The output key MUST be `output` (string). The agent reads `items[0].json.output` to build its tool observation.

### Step 3 — Get embeddings and reranker inside `execute()`

`getInputConnectionData` works in the `IExecuteFunctions` context:

```typescript
const embeddings = await this.getInputConnectionData(
    NodeConnectionTypes.AiEmbedding, 0
) as { embedQuery(text: string): Promise<number[]> };

const reranker = await this.getInputConnectionData(
    NodeConnectionTypes.AiReranker, 0
) as { compressDocuments(docs: Doc[], query: string): Promise<Doc[]> } | undefined;
```

### Step 4 — `supplyData()`: schema registration

You must still implement `supplyData()`. It tells the agent the tool's name, description, and input schema. Use `DynamicStructuredTool` with a **plain JSON Schema object** (NOT Zod — see pitfalls).

```typescript
async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const { DynamicStructuredTool } = require('@langchain/core/tools');

    const tool = new DynamicStructuredTool({
        name: nodeNameToToolName(this.getNode()),
        description: 'Your tool description here',
        schema: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Query to search for' },
            },
            required: ['input'],
        },
        func: async ({ input }: { input: string }) => {
            // Fallback path only — normally execute() handles this
            return JSON.stringify({ message: 'Use execute() path' });
        },
    });

    return { response: tool };
}
```

### Step 5 — Build and deploy

```bash
npm run build           # produces dist/
docker cp dist/nodes/YourNode.node.js n8n:/path/to/custom/nodes/
docker restart n8n
```

### Step 6 — Verify

Check the deployed JS has the correct pattern:
```bash
docker exec n8n grep -n "DynamicStructuredTool\|items\[0\].*json.*input\|embedQuery" \
  /path/to/deployed/YourNode.node.js
```

Expected: `DynamicStructuredTool`, `items[0]?.json?.input`, `embedQuery` all present.

---

## What Native Nodes Use vs. What You Must Replace

See [native-vs-custom reference](./references/native-vs-custom.md) for the full comparison table.

Short version:
| Native utility | Available to community node? | Replacement |
|---|---|---|
| `logWrapper` from `@n8n/ai-utilities` | ❌ Not importable | Manual `addInputData` / `addOutputData` in `supplyData.func` |
| `createToolFromNode` from `@n8n/ai-utilities` | ❌ Not importable | Use `DynamicStructuredTool` directly |
| Zod schema via `require('zod')` | ⚠️ Cross-instance mismatch | Plain JSON Schema object `{ type: 'object', ... }` |
| `getInputConnectionData` in `execute()` | ✅ Works | — |
| `nodeNameToToolName` from `n8n-workflow` | ✅ Works | — |

---

## Code Template

Start from the complete working scaffold:
→ [assets/hybrid-search-tool.template.ts](./assets/hybrid-search-tool.template.ts)

It includes all the boilerplate with TODOs for your specific database client.

---

## Common Pitfalls

1. **`execute()` returns `[[]]` always** — tool invocations silently return nothing to agent. Fix: branch on `items[0]?.json?.input`.

2. **`execute()` throws** — causes `"node threw"` error. Fix: branch and return gracefully.

3. **`new DynamicTool(...)` instead of `DynamicStructuredTool`** — agent may pass `{input:"..."}` object to a string-expecting func.

4. **Zod schema via `require('zod')`** — produces `type: "None"` / `Bad request` from OpenAI. Zod `instanceof` checks fail across module boundaries. Fix: use plain JSON Schema object.

5. **`supplyData()` only, no `execute()`** — partial run engine throws `"has supplyData but no execute"`. Always implement both.

6. **Output key is wrong** — agent reads `items[0].json.output`. If you return `{ json: { result: "..." } }` the agent sees nothing.

7. **`logWrapper` import fails** — it lives in n8n's pnpm sandbox, not resolvable from custom node paths. Use manual tracking instead.
