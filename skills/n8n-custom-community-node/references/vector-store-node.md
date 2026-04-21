# Vector Store And Hybrid Search Pattern

Use this path for a retrieval node that lives on the AI tool bus and also consumes embeddings, optionally rerankers, or similar AI sub-node dependencies.

## Use When

- The node exposes `AiTool` to an AI Agent.
- The node consumes `AiEmbedding`.
- The node may also consume `AiReranker`.
- The runtime flow is query embedding, search, optional rerank, then structured result return.
- You want it to follow the same architecture as `CosmosDbHybridSearchTool.node.ts`.

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
    → execute() embeds the query, calls the DB, and returns ordinary n8n items like [{ json: {...} }]
```

**`supplyData.func` is never called by the LangChain agent at runtime.**
The agent goes through n8n's `makeHandleToolInvocation` → `execute()` path. The `func` you write in `supplyData` covers only the rare case where something calls it directly — treat it as a fallback path for correctness.

---

## Node Wiring

```typescript
outputs: [NodeConnectionTypes.AiTool],
inputs: [
    { displayName: 'Embeddings', type: NodeConnectionTypes.AiEmbedding, required: true, maxConnections: 1 },
    { displayName: 'Reranker',   type: NodeConnectionTypes.AiReranker,  required: false, maxConnections: 1 },
],
```

Do not switch this to `usableAsTool` + `Main` output unless you intentionally want the different architecture used by `CosmosDb.node.ts`.

If you add a `useReranker` toggle, treat it as a wiring change, not just a UI change — gate the `AiReranker` connection lookup behind that same toggle.

---

## Step-by-Step Procedure

### Step 1 — Node description boilerplate

Set outputs and inputs exactly as shown in Node Wiring above. Both `supplyData()` and `execute()` are required — the partial run engine throws `"has supplyData but no execute"` if you omit `execute()`.

### Step 2 — `execute()`: the dual-role method (MOST CRITICAL)

`execute()` is called in two contexts. Detect which context you're in by checking for a non-empty `input` field:

```typescript
async execute(): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const query = ((items[0]?.json?.input as string) || '').trim();

    if (!query) {
        // Context A: partial workflow run / setup — return gracefully, NOT throw
        return [[]];
    }

    // Context B: runtime tool invocation by the AI Agent
    // query = the agent's plain-text question
    // ... do real work here ...
    return [results.map((result) => ({ json: result }))];
}
```

> `execute()` returns ordinary n8n items on success: `{ json: doc }` and `{ json: { error: message } }`. Do NOT wrap structured results in `JSON.stringify(...)` — that makes the output appear as a quoted JSON blob in n8n and downstream nodes.

### Step 3 — Get embeddings and reranker inside `execute()`

```typescript
const embeddings = (await this.getInputConnectionData(NodeConnectionTypes.AiEmbedding, 0)) as {
    embedQuery(text: string): Promise<number[]>;
};

const useReranker = this.getNodeParameter('useReranker', 0, false) as boolean;

const reranker = useReranker
    ? ((await this.getInputConnectionData(NodeConnectionTypes.AiReranker, 0)) as
            | { compressDocuments(docs: Doc[], query: string): Promise<Doc[]> }
            | undefined)
    : undefined;
```

**Common mistake**: adding `useReranker` but still calling `getInputConnectionData(AiReranker, 0)` unconditionally. When no reranker is connected, this fails even though the toggle is off. Always read the toggle first, then guard the lookup.

### Step 4 — `supplyData()`: schema registration

Use `DynamicStructuredTool` with a **plain JSON Schema object** (NOT Zod — see pitfalls below):

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
            // Fallback path only — execute() handles normal agent invocations
            return 'Use execute() path';
        },
    });

    return { response: tool };
}
```

> Use `addInputData` / `addOutputData` inside `supplyData.func` to track this fallback path in n8n's execution panel. `logWrapper` from `@n8n/ai-utilities` is NOT importable from custom node paths — see `references/native-vs-custom.md`.

### Step 5 — Build and deploy

```bash
npm run build           # produces dist/
docker cp dist/nodes/YourNode.node.js n8n:/path/to/custom/nodes/
docker restart n8n
```

### Step 6 — Verify

```bash
docker exec n8n grep -n "DynamicStructuredTool\|items\[0\].*json.*input\|embedQuery" \
  /path/to/deployed/YourNode.node.js
```

Expected: `DynamicStructuredTool`, `items[0]?.json?.input`, and `embedQuery` all present.

---

## Native vs Community — What You Must Replace

See `references/native-vs-custom.md` for the full reverse-engineered comparison from n8n v2.12.3 internals.

| Native utility | Available to community node? | Replacement |
|---|---|---|
| `logWrapper` from `@n8n/ai-utilities` | ❌ Not importable (pnpm sandbox) | Manual `addInputData` / `addOutputData` in `supplyData.func` |
| `createToolFromNode` from `@n8n/ai-utilities` | ❌ Not importable | Use `DynamicStructuredTool` directly |
| Zod schema via `require('zod')` | ⚠️ Cross-instance mismatch | Plain JSON Schema object `{ type: 'object', ... }` |
| `getInputConnectionData` in `execute()` | ✅ Works | — |
| `nodeNameToToolName` from `n8n-workflow` | ✅ Works | — |

---

## Common Pitfalls

1. **`execute()` returns `[[]]` always** — tool invocations silently return nothing to agent. Fix: branch on `items[0]?.json?.input`.

2. **`execute()` throws** — causes `"node threw"` error. Fix: branch on empty query and return gracefully.

3. **`new DynamicTool(...)` instead of `DynamicStructuredTool`** — agent may pass `{input:"..."}` object to a string-expecting func.

4. **Zod schema via `require('zod')`** — produces `type: "None"` / `Bad request` from OpenAI. Zod `instanceof` checks fail across module boundaries. Fix: use plain JSON Schema object.

5. **`supplyData()` only, no `execute()`** — partial run engine throws `"has supplyData but no execute"`. Always implement both.

6. **Structured result wrapped in a string** — returning `JSON.stringify(results)` from `execute()` makes the tool output appear as a quoted JSON blob. Return ordinary structured items instead: `results.map((doc) => ({ json: doc }))`.

7. **Reranker toggle added, but reranker lookup left unconditional** — once you add `useReranker`, you must also guard `getInputConnectionData(NodeConnectionTypes.AiReranker, 0)`. Otherwise the node can error when the toggle is off and no reranker connection exists.

8. **Mixing architectures** — `CosmosDb.node.ts` uses `usableAsTool` with `Main` output, while `CosmosDbHybridSearchTool.node.ts` uses direct `AiTool` + `supplyData()`. Do not mix guidance from both patterns unless you are intentionally redesigning the node.

9. **`logWrapper` import fails** — it lives in n8n's pnpm sandbox, not resolvable from custom node paths. Use manual `addInputData`/`addOutputData` tracking instead.

---

## Starter Template

Use `../assets/vector-store-node.template.ts` as the starting point. It includes all boilerplate with TODO markers for your specific database client, credentials, `addInputData`/`addOutputData` tracking, and proper error handling.

---

## Quick Start

```bash
# Scaffold then replace the generated class with the vector-store template
npm create @n8n/node@latest my-package -- --template programmatic/example
cd my-package
# Replace nodes/ with ../assets/vector-store-node.template.ts adapted to your service
npm run build
npm run dev   # starts n8n at localhost:5678 with hot-reload
```

---

## Official Documentation Links

| Topic                      | URL                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cluster nodes — sub-nodes  | https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/                                          |
| Vector Store Retriever     | https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.retrievervectorstore/ |
| Embeddings sub-nodes       | https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/                                         |
| Reranker Cohere (example)  | https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.rerankercohere/       |
| Programmatic node tutorial | https://docs.n8n.io/integrations/creating-nodes/build/programmatic-style-node/                             |
| CLI tool (n8n-node)        | https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/                                            |
| Node linter                | https://docs.n8n.io/integrations/creating-nodes/test/node-linter/                                         |
