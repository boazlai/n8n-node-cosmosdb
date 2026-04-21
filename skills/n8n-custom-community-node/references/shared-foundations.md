# Shared Foundations

Read this file before any variant-specific guide. It covers the full lifecycle: scaffold → build → test → publish.

## Bootstrap a New Package

### Recommended (no global install required)

```bash
npm create @n8n/node@latest
```

This launches an interactive wizard that asks for the package name, node type, base URL, and credential type. It scaffolds a ready-to-use TypeScript project with `package.json`, `tsconfig.json`, `gulpfile.js`, `nodes/`, `credentials/`, and a pre-wired `.github/workflows/publish.yml`.

To pass arguments non-interactively:

```bash
npm create @n8n/node@latest n8n-nodes-myservice -- --template declarative/custom
```

### Alternative (requires global install)

```bash
npm install --global @n8n/node-cli
n8n-node new
# or with arguments:
n8n-node new n8n-nodes-myservice --template declarative/custom
```

### Available Templates

| Template                    | Style        | Best for                                                            |
| --------------------------- | ------------ | ------------------------------------------------------------------- |
| `declarative/github-issues` | Declarative  | Full demo with multiple operations + credentials                    |
| `declarative/custom`        | Declarative  | Starting blank with guided prompts; asks for base URL and auth type |
| `programmatic/example`      | Programmatic | Full flexibility for complex data transformation                    |

Auth types offered during `declarative/custom`: API Key, Bearer Token, OAuth2, Basic Auth, Custom, None.

Scaffold uses `--skip-install` flag to skip running `npm install` automatically if needed.

Scoped packages are supported: `@<YOUR_ORG>/n8n-nodes-<YOUR_NODE_NAME>`.

> **Node.js requirement**: v22 or later.

---

## CLI Commands Reference

All commands below have both a direct CLI form (`n8n-node`) and an `npm run` shortcut from the scaffolded `package.json`.

| Command               | npm shortcut       | What it does                                                                                                |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `n8n-node new`        | —                  | Scaffold a new node package interactively                                                                   |
| `n8n-node build`      | `npm run build`    | Compile TypeScript and copy assets into `dist/`                                                             |
| `n8n-node dev`        | `npm run dev`      | Build, then start an embedded n8n at `localhost:5678` with auto-rebuild on file changes                     |
| `n8n-node lint`       | `npm run lint`     | Run the n8n node linter                                                                                     |
| `n8n-node lint --fix` | `npm run lint:fix` | Auto-fix lint errors                                                                                        |
| `n8n-node release`    | `npm run release`  | Build + lint + bump version + generate changelog + create git tag + trigger GitHub release + publish to npm |

> **`npm run dev` caveat**: This command spawns its own n8n instance at port 5678. If you already have n8n running in Docker on the same port, they will conflict. Use the Docker test method below instead.

---

## Package Layout

Use a conventional community-node package structure:

```text
package.json
tsconfig.json
gulpfile.js
nodes/
credentials/
dist/
README.md
```

Keep source under `nodes/` and `credentials/`. Treat `dist/` as the build artifact, not the source of truth.

## Minimal Packaging Rules

- Give each exported node class a stable `displayName`, `name`, and `description`.
- Keep `name` machine-friendly and consistent with the node filename.
- Register built node files in `package.json` under the package's `n8n` metadata.
- Keep credentials in separate files under `credentials/`.
- Do not mix unrelated node variants into one class.

## Architecture Choice

Choose the node shape early:

- Standard node: use `Main` connections and `execute()`.
- AI tool node: use `AiTool`, `supplyData()`, and `execute()`.
- Vector store node: use `AiTool` plus `AiEmbedding`, optionally `AiReranker`, with retrieval logic in `execute()`.

Switching architectures halfway through usually produces broken connections, stale build output, or incorrect node metadata.

## Implementation Rules

- Prefer a small working node over a highly configurable broken scaffold.
- Keep parameter names explicit and stable.
- Make runtime errors actionable with `NodeOperationError` when the failure is user-fixable.
- Separate service helpers from node execution flow when the logic grows beyond one screen.
- Do not teach patterns that rely on private n8n internals when a public `n8n-workflow` API exists.

## Build And Validation Checklist

Before calling the node finished, verify all of the following:

1. The TypeScript source compiles.
2. `dist/` contains the updated node artifact.
3. The package metadata points at the correct built file.
4. Inputs and outputs match the intended architecture.
5. The node class name, filename, and exported package metadata align.

## Public Distribution Checklist

If the user wants to publish the package or copy it to another workspace:

1. Keep the package name generic and service-appropriate.
2. Remove hard-coded local paths, container names, or workspace-specific assumptions.
3. Document required credentials and environment dependencies in `README.md`.
4. Confirm build output comes only from `dist/`.
5. Keep examples generic unless the package is intentionally service-specific.

## Common Pitfalls

- Updating source but forgetting to rebuild `dist/`.
- Registering the wrong built filename in `package.json`.
- Mixing `Main` outputs with AI-tool-only behavior.
- Baking repo-specific examples into the reusable template.
- Publishing a package whose README does not explain credentials or compatibility.

---

## Testing Your Node

Pick the method that matches your setup.

### Method A — Embedded n8n (simplest, no existing Docker container)

```bash
npm run dev
# or: n8n-node dev
```

Builds and starts n8n at `http://localhost:5678`. Watches for TypeScript changes and rebuilds automatically. Best for fresh machines without an existing n8n service.

**Limitation**: Conflicts with a Docker-based n8n already running on port 5678.

---

### Method B — Build + Docker copy (recommended when using Docker-based n8n)

1. Build the node:

   ```bash
   npm run build
   ```

2. Copy the compiled output into the running container (adjust paths to your setup):

   ```bash
   docker cp dist/ n8n:/home/node/.n8n/custom/node_modules/<your-package-name>/dist/
   ```

3. Restart n8n:
   ```bash
   docker compose restart n8n
   ```

This avoids port conflicts and keeps your existing n8n data intact.

---

### Method C — npm link (requires globally-installed n8n)

Prerequisite: `npm install n8n -g`

1. In your node project directory:

   ```bash
   npm run build && npm link
   ```

2. In the `~/.n8n/custom/` directory (create it if it does not exist):

   ```bash
   # If custom/ doesn't exist:
   mkdir -p ~/.n8n/custom && cd ~/.n8n/custom && npm init -y

   # Then link:
   npm link <your-package-name>
   ```

3. Start n8n:
   ```bash
   n8n start
   ```

**Important**: In the n8n UI, search by the node's **display name** (e.g., `Weather`), not the npm package name (e.g., `n8n-nodes-weather`).

**Alternative path**: Set the `N8N_CUSTOM_EXTENSIONS` environment variable to a directory path to change where n8n loads custom nodes from.

---

## Publishing to npm

### Quick path (new packages scaffolded with `npm create @n8n/node`)

The scaffold already includes `.github/workflows/publish.yml`. To publish:

1. Commit your work to GitHub.
2. Run `npm run release` locally — this bumps the version, commits, creates a git tag, and pushes.
3. The push triggers the GitHub Actions publish workflow, which publishes to npm with provenance.

### Existing packages

Copy the publish workflow from the n8n starter repo:  
`https://github.com/n8n-io/n8n-nodes-starter/blob/master/.github/workflows/publish.yml`

Place it at `.github/workflows/publish.yml` in your repo. Also ensure `@n8n/node-cli` is `>= 0.23.0` in devDependencies:

```bash
npm list @n8n/node-cli
```

### One-time npm trusted publisher setup

To publish without storing a long-lived npm token:

1. Log in to npmjs.com and open the package settings.
2. Under **Publish access > Trusted Publishers**, click **Add a publisher**.
3. Select **GitHub Actions** and fill in: repository owner, repository name, workflow name: `publish.yml`.

Alternatively, create a Granular Access Token on npmjs.com and store it as `NPM_TOKEN` in GitHub Actions secrets.

### Provenance requirement (critical for n8n verification)

**From May 1, 2026**, nodes submitted for n8n Cloud verification MUST be published via GitHub Actions with a provenance statement. Publishing directly from a local machine will be rejected for verification purposes. You can still publish to npm without provenance for unverified community nodes.

---

## Community Node Installation (End-User Perspective)

### GUI install (self-hosted n8n)

Requires Owner or Admin role.

1. Go to **Settings > Community Nodes**.
2. Click **Install**.
3. Click **Browse** to search npm by `n8n-community-node-package` keyword, or paste the package name directly.
4. Enter the package name (e.g., `n8n-nodes-myservice`) or a versioned form (e.g., `n8n-nodes-myservice@2.1.0`).
5. Accept the risk warning and click **Install**.

### GUI upgrade/downgrade

- Upgrade to latest: click the **Update** button visible in Settings > Community Nodes when a new version is available.
- Upgrade to specific version: uninstall the node, then reinstall with version pinned.
- Downgrade: same as above — uninstall then reinstall targeting the older version.

### Manual install (Docker or self-hosted)

See official docs: https://docs.n8n.io/integrations/community-nodes/installation/manual-install/

---

## Verification Checklist (for n8n Creator Portal submission)

- [ ] Package name starts with `n8n-nodes-` or `@scope/n8n-nodes-`
- [ ] `n8n-community-node-package` in npm `keywords`
- [ ] All nodes and credentials registered under the `n8n` key in `package.json`
- [ ] Zero runtime `dependencies` (only `devDependencies` allowed)
- [ ] Passes `npm run lint` with no errors
- [ ] Node follows technical guidelines and UX guidelines (see Official Documentation Links)
- [ ] Published via GitHub Actions with provenance (required from May 1, 2026)
- [ ] README explains credentials, compatibility, and usage
- [ ] Submit via: https://creators.n8n.io/nodes

---

## Official Documentation Links

| Topic                          | URL                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| CLI tool (n8n-node)            | https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/                          |
| Dev environment setup          | https://docs.n8n.io/integrations/creating-nodes/build/node-development-environment/      |
| Run node locally (npm link)    | https://docs.n8n.io/integrations/creating-nodes/test/run-node-locally/                   |
| Install private nodes (Docker) | https://docs.n8n.io/integrations/creating-nodes/deploy/install-private-nodes/            |
| Submit community nodes         | https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/           |
| Starter repo (GitHub)          | https://github.com/n8n-io/n8n-nodes-starter                                              |
| Community nodes GUI install    | https://docs.n8n.io/integrations/community-nodes/installation/gui-install/               |
| Community nodes manual install | https://docs.n8n.io/integrations/community-nodes/installation/manual-install/            |
| Verification guidelines        | https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/ |
| UX guidelines                  | https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/           |
| Node file structure            | https://docs.n8n.io/integrations/creating-nodes/build/reference/node-file-structure/     |
| Declarative-style tutorial     | https://docs.n8n.io/integrations/creating-nodes/build/declarative-style-node/            |
| Programmatic-style tutorial    | https://docs.n8n.io/integrations/creating-nodes/build/programmatic-style-node/           |
| Creator Portal                 | https://creators.n8n.io/nodes                                                            |
| Node linter                    | https://docs.n8n.io/integrations/creating-nodes/test/node-linter/                        |
| Troubleshoot node dev          | https://docs.n8n.io/integrations/creating-nodes/test/troubleshooting-node-development/   |
