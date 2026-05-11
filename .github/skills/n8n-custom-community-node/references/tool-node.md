# AI Tool Node Pattern

Use this path for a custom node that an n8n AI Agent should call as a tool.

## Use When

- The node should output `AiTool`.
- The node is selected by an AI Agent rather than only by main data-flow routing.
- The node must register a tool definition through `supplyData()`.

## Required Architecture

Implement both methods:

- `supplyData()` to register the tool name, description, and input schema.
- `execute()` because nodes with `supplyData()` still need an executable runtime method.

Keep the connection shape explicit:

- `outputs: [NodeConnectionTypes.AiTool]`
- `inputs` should list only the sub-node dependencies the tool actually needs.

## Runtime Rule

Do not rely on `supplyData().func` as the main execution path. In practice, the LangChain agent path should end up using the node runtime flow. Put real retrieval or action logic where the node can execute it reliably, and keep the tool registration schema aligned with that runtime contract.

## Schema Rule

Use a structured input schema for the tool. Keep the schema small and explicit. If the tool takes a single query, expose a single `input` property rather than a loose blob.

## Output Rule

Return ordinary n8n items from runtime execution. Preserve arrays and objects as structured values instead of stringifying them unless the downstream contract explicitly requires a string.

## fromAI Override Button (✨)

n8n shows a ✨ ("Let AI generate value") button on string parameters for nodes that belong to the `AI` category with `subcategories.AI` containing `Tools`. This lets users opt individual parameters into AI-generated values at design time.

### Why it does not appear on CUSTOM nodes by default

n8n's `n8n-core` directory-loader **ignores** `node.description.codex` for any node loaded from a CUSTOM package (nodes mounted under `custom/node_modules/`). Instead it reads a sidecar `.node.json` file from the same directory as the built `.node.js`, then appends `"Custom Nodes"` to whatever categories it finds. If no sidecar exists, the runtime codex becomes `{ categories: ["Custom Nodes"] }` and the ✨ check fails.

### How to enable it

Create a sidecar `<YourNode>.node.json` next to the `.ts` source (e.g. `nodes/MyTool/MyTool.node.json`):

```json
{
	"categories": ["AI"],
	"subcategories": {
		"AI": ["Tools"],
		"Tools": ["Other Tools"]
	},
	"resources": {
		"primaryDocumentation": [],
		"credentialDocumentation": []
	}
}
```

> At runtime, n8n appends `"Custom Nodes"` → categories becomes `["AI", "Custom Nodes"]`, which passes the ✨ check.

**Important**: Do NOT include `"Vector Stores"` in `subcategories.AI`. The ✨ button is explicitly blocked for Vector Stores in the n8n frontend.

### Copy the JSON to dist in the build step

The scaffolded `gulpfile.js` only copies images by default. Extend it to also copy `*.json` files:

```javascript
const { task, src, dest, parallel } = require('gulp');

function copyNodeIcons() {
	return src('nodes/**/*.{png,svg}').pipe(dest('dist/nodes'));
}
function copyCredIcons() {
	return src('credentials/**/*.{png,svg}').pipe(dest('dist/credentials'));
}
function copyNodeCodex() {
	return src('nodes/**/*.json').pipe(dest('dist/nodes'));
}

task('build:icons', parallel(copyNodeIcons, copyCredIcons, copyNodeCodex));
```

### Parameters that can never show ✨

Even with a correct codex, these parameter types are hardcoded to never show the button:

- `options` (dropdown menus)
- `credentialsSelect`

And these parameter paths are always excluded:

- `parameters.toolName`
- `parameters.description`
- `parameters.toolDescription`

---

## Common Pitfalls

- Building only `supplyData()` and forgetting `execute()`.
- Registering `AiTool` output but still wiring the node like a standard `Main` node.
- Returning stringified JSON blobs instead of structured data.
- Leaving stale `dist/` output in place and testing the wrong artifact.
- **Missing sidecar `.node.json`** — `node.description.codex` is silently ignored for CUSTOM nodes. Without the sidecar, the ✨ button never appears regardless of what is set in the TypeScript source.
- **`"Vector Stores"` in `subcategories.AI`** — blocks the ✨ button even if `"AI"` and `"Tools"` are correct.
- **Sidecar not copied to `dist/`** — the default `gulpfile.js` only copies images; add a `copyNodeCodex` task to copy `*.json` files.

## Starter Template

Use `../assets/tool-node.template.ts` as the starting point.

---

## Quick Start

```bash
# Scaffold (programmatic style — required for AiTool nodes)
npm create @n8n/node@latest my-package -- --template programmatic/example
cd my-package
# Replace the generated node class with the AiTool + supplyData() architecture
npm run build
npm run dev   # starts n8n at localhost:5678 with hot-reload
```

Note: The scaffold templates generate standard nodes. Switch to the AiTool architecture manually using `../assets/tool-node.template.ts`.

---

## Official Documentation Links

| Topic                           | URL                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AI sub-nodes overview           | https://docs.n8n.io/integrations/builtin/cluster-nodes/                                                            |
| Programmatic node tutorial      | https://docs.n8n.io/integrations/creating-nodes/build/programmatic-style-node/                                     |
| Node base file (execute method) | https://docs.n8n.io/integrations/creating-nodes/build/reference/node-base-files/programmatic-style-execute-method/ |
| CLI tool (n8n-node)             | https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/                                                    |
| Node linter                     | https://docs.n8n.io/integrations/creating-nodes/test/node-linter/                                                  |
