# Native Vector Store Node vs. Community Node — Full Comparison

This was reverse-engineered by reading n8n internals at n8n version 2.12.3.

## Source files investigated

| File                                                                                       | Purpose                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `n8n-core/dist/execution-engine/node-execution-context/utils/get-input-connection-data.js` | Two-phase invocation engine — `supplyData` call (line 274), `makeHandleToolInvocation` (line 261) |
| `@n8n/ai-utilities/dist/cjs/utils/vector-store/.../retrieveAsToolOperation.js`             | Native supplyData pattern                                                                         |
| `@n8n/ai-utilities/dist/cjs/utils/fromai-tool-factory.js`                                  | `createToolFromNode` → `DynamicStructuredTool` factory                                            |
| `@n8n/ai-utilities/dist/cjs/utils/log-wrapper.js`                                          | Auto-tracking wrapper for tool `_call` and embeddings `embedQuery`                                |
| `n8n-core/dist/execution-engine/node-execution-context/supply-data-context.js`             | `addInputData` implementation                                                                     |

---

## Full Comparison Table

| Aspect                 | Native node                                                                                                | Community node                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool class             | `DynamicStructuredTool` via `createToolFromNode`                                                           | `DynamicStructuredTool` via `require('@langchain/core/tools')` — same class, different import path                                                                          |
| Input schema           | Zod schema (`z.object({ input: z.string() })`) — same module instance as LangChain                         | **Plain JSON Schema object** `{ type: 'object', properties: { input: { type: 'string' } }, required: ['input'] }` — avoids cross-module `instanceof` failure                |
| Sub-node tracking      | `logWrapper(tool, context)` wraps `_call`, `embedQuery`, `embedDocuments` automatically                    | Manual `addInputData` / `addOutputData` inside `supplyData.func` (covers fallback path only; n8n engine tracks `execute()` calls automatically)                             |
| Reranker               | Fetched **lazily** inside `func` (at tool call time)                                                       | Fetched inside `execute()` which IS the tool call time — same effect                                                                                                        |
| `execute()` role       | Reads `items[0].json.input`, embeds, queries DB, then hands the tool result back to the runtime            | In this repo's `CosmosDbHybridSearchTool.node.ts`, `execute()` returns ordinary n8n items such as `[{ json: doc }]` on success rather than forcing a `json.output` wrapper. |
| `supplyData.func` role | Covers the LangChain-direct call path; also used if n8n ever routes tool calls through the LangChain stack | Same — treat as dead code for the main n8n agent flow, but implement for correctness                                                                                        |

---

## Why `logWrapper` Cannot Be Used

`logWrapper` lives at:

```
/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+ai-utilities@.../node_modules/@n8n/ai-utilities
```

This is inside n8n's **pnpm sandbox** — not resolvable via `require('@n8n/ai-utilities')` from a custom node's module resolution path. Hardcoding the absolute path would be fragile across n8n versions.

What `logWrapper` does:

- Wraps tool's `_call` method → auto-calls `addInputData`/`addOutputData` for `ai_tool` connection
- Wraps `embedQuery`/`embedDocuments` → makes embeddings node show green output in UI

**Replacement**: Call `addInputData`/`addOutputData` manually inside `supplyData.func`. The embeddings connection line will stay dotted in the UI (cosmetic only — functionally identical).

---

## Why `require('zod')` Fails for Schema

When n8n resolves `require('zod')` from a community node's path, it loads a **different Zod module instance** than the one `@langchain/core` was compiled against.

LangChain's `structuredOutputParser.zodToJsonSchema()` uses:

```javascript
if (schema instanceof ZodObject) { ... }
```

`instanceof` checks the constructor reference. Different instances = fails. The schema is not converted. OpenAI receives a raw JavaScript object which it can't parse as a JSON Schema → error:

```
Invalid schema for function '...': schema must be a JSON Schema of type "object", got type "None"
```

**Fix**: Pass a plain JSON Schema object — no `instanceof` check needed:

```javascript
schema: {
    type: 'object',
    properties: {
        input: { type: 'string', description: 'Query to search for' }
    },
    required: ['input']
}
```

---

## Two-Phase Invocation — Code Path Detail

### Phase 1: Setup

```javascript
// get-input-connection-data.js line 274
const supplyDataResult = await nodeType.supplyData.call(context, itemIndex);
// supplyDataResult.response = your DynamicStructuredTool
// registered in agent's tool list
```

### Phase 2: Runtime (agent calls the tool)

```javascript
// get-input-connection-data.js line 261
const result = await makeHandleToolInvocation({
  workflow,
  runExecutionData,
  connectionInputData /* ... */,
});
// This calls: nodeType.execute.call(executeFunctionContext)
// Input arrives as: executeFunctionContext.getInputData()[0].json.input
// Output in this repo's working hybrid-search node is ordinary n8n items, e.g. [{ json: doc }]
```

Keep arrays / objects as raw structured values. Do not pre-stringify them with `JSON.stringify(...)` unless the consumer explicitly requires plain text.
In this repo's `CosmosDbHybridSearchTool.node.ts`, `execute()` returns ordinary n8n items and does not rely on `items[0].json.output` as a mandatory wrapper.

If you add a `useReranker` toggle, guard the reranker lookup the same way in runtime code:

```typescript
const useReranker = this.getNodeParameter("useReranker", 0, false) as boolean;
const reranker = useReranker
  ? ((await this.getInputConnectionData(NodeConnectionTypes.AiReranker, 0)) as
      | IRerankerModel
      | undefined)
  : undefined;
```

Leaving the `AiReranker` lookup unconditional after adding the toggle is a common source of setup and execution errors when no reranker connection exists.

---

## Run Data Evidence (Execution 101, pre-fix)

```json
"inputOverride": {
  "ai_tool": [[{ "json": { "input": "equipment of ccmr" } }]]
},
"executionTime": 4,
"data": {
  "ai_tool": [[]]
}
```

`execute()` was returning `[[]]` → agent received nothing → "I couldn't find any information". After fix: executionTime increases and the runtime contains real returned items instead of an empty `ai_tool` payload.
