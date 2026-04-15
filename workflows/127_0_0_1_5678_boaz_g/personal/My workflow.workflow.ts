import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : My workflow
// Nodes   : 29  |  Connections: 23
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Lightrag                           lightRAG                   [creds]
// OnFormSubmission                   formTrigger
// UploadPdf                          httpRequest
// GetUrl                             httpRequest
// GetDocument                        httpRequest
// SplitOutPages                      splitOut
// ConvertToFile1                     convertToFile
// Crypto1                            crypto
// Setnewfilename1                    set
// Merge2                             merge
// ParseImageJson1                    set
// Forloopend1                        set
// Aggregate1                         aggregate
// Merge3                             merge
// IfHaveImage                        if
// SplitOutImage                      splitOut                   [onError→regular] [alwaysOutput]
// ReplaceImageAltTextWithAnnotation  code
// CreateBlob                         azureStorage
// ReplaceImageUrl                    code
// MergePages                         code
// AiAgent                            agent                      [AI]
// EmbeddingsAzureOpenai              embeddingsAzureOpenAi
// HybridSearchDocuments              cosmosDb                   [creds]
// SelectDocumentsInCosmosDb          cosmosDbTool               [AI] [creds] [ai_tool]
// EmbeddingsOpenai                   embeddingsOpenAi           [creds] [ai_embedding]
// WhenClickingExecuteWorkflow        manualTrigger
// EditFields                         set
// OpenaiChatModel                    lmChatOpenAi               [creds] [ai_languageModel]
// HttpRequest                        httpRequestTool            [ai_tool]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// OnFormSubmission
//    → UploadPdf
//      → GetUrl
//        → GetDocument
//          → SplitOutPages
//            → SplitOutImage
//              → IfHaveImage
//                → ParseImageJson1
//                  → ConvertToFile1
//                    → Crypto1
//                      → Setnewfilename1
//                        → Merge2
//                          → CreateBlob
//                            → Forloopend1
//                              → Aggregate1
//                                → Merge3
//                                  → ReplaceImageUrl
//                    → Merge2.in(1) (↩ loop)
//               .out(1) → Merge3 (↩ loop)
//          → ReplaceImageAltTextWithAnnotation
//            → MergePages
//              → Merge3.in(1) (↩ loop)
// WhenClickingExecuteWorkflow
//    → EditFields
//      → AiAgent
//
// AI CONNECTIONS
// AiAgent.uses({ ai_tool: [SelectDocumentsInCosmosDb, HttpRequest], ai_languageModel: OpenaiChatModel })
// SelectDocumentsInCosmosDb.uses({ ai_embedding: EmbeddingsOpenai })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'SFQUsyJqgw0LoIzY',
    name: 'My workflow',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate' },
})
export class MyWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: '77adfb49-3d42-446b-b096-f4e009e43bcd',
        name: 'LightRAG',
        type: 'CUSTOM.lightRAG',
        version: 1,
        position: [-112, 288],
        credentials: { lightRAGCosmosDB: { id: 'QqjtHIkoofzYb8Ta', name: 'LightRAG CosmosDB (vCore) account' } },
    })
    Lightrag = {
        operation: 'query',
    };

    @node({
        id: '1c47633c-475e-449e-a8ec-61abb69f7d88',
        webhookId: '018ecd0e-7989-4a0e-8173-18e4dd4e35e8',
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        version: 2.5,
        position: [-1600, 16],
    })
    OnFormSubmission = {
        formTitle: 'asdfsa',
        formDescription: 'asdfsa',
        formFields: {
            values: [
                {
                    fieldLabel: 'data',
                    fieldType: 'file',
                },
            ],
        },
        options: {},
    };

    @node({
        id: '1fce7d98-953b-4369-a975-bccfbf32f301',
        name: 'Upload pdf',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [-1344, 16],
        retryOnFail: false,
        maxTries: 3,
        waitBetweenTries: 3000,
    })
    UploadPdf = {
        method: 'POST',
        url: 'https://api.mistral.ai/v1/files',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'mistralCloudApi',
        sendBody: true,
        contentType: 'multipart-form-data',
        bodyParameters: {
            parameters: [
                {
                    name: 'purpose',
                    value: 'ocr',
                },
                {
                    parameterType: 'formBinaryData',
                    name: 'file',
                    inputDataFieldName: 'data',
                },
            ],
        },
        options: {
            response: {
                response: {
                    responseFormat: 'json',
                },
            },
        },
    };

    @node({
        id: '4e63466c-cffd-4b3f-8770-c89ed3161b53',
        name: 'get url',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [-1120, 16],
        retryOnFail: false,
        maxTries: 5,
        waitBetweenTries: 5000,
    })
    GetUrl = {
        url: '=https://api.mistral.ai/v1/files/{{ $json.id }}/url ',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'mistralCloudApi',
        sendQuery: true,
        queryParameters: {
            parameters: [
                {
                    name: 'expiry',
                    value: '24',
                },
            ],
        },
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/json',
                },
            ],
        },
        options: {},
    };

    @node({
        id: '2832bb64-d995-4a00-8243-524f6961f557',
        name: 'Get document',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [-896, 16],
        retryOnFail: false,
        maxTries: 5,
        waitBetweenTries: 5000,
    })
    GetDocument = {
        method: 'POST',
        url: 'https://api.mistral.ai/v1/ocr',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'mistralCloudApi',
        sendHeaders: true,
        headerParameters: {
            parameters: [{}],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={
  "model": "mistral-ocr-latest",
  "document": {
    "type": "document_url",
    "document_url": "{{ $json.url }}"
  },
  "include_image_base64": true,
  "bbox_annotation_format": {
          "type": "json_schema",
          "json_schema": {
              "schema": {
                  "properties": {
  "description": {
    "title": "Description",
    "type": "string",
    "description": "Detailed description including all numbers, names, dates, relationships, and key findings visible in the image"
  }
},
                  "required": ["short_description"],
                  "title": "BBOXAnnotation",
                  "type": "object",
                  "additionalProperties": false
              },
              "name": "document_annotation",
              "strict": true
          }
      }
}`,
        options: {
            response: {
                response: {
                    responseFormat: 'json',
                },
            },
        },
    };

    @node({
        id: '05b9df1e-0d9e-4d2f-b561-de8856ed1301',
        name: 'Split Out Pages',
        type: 'n8n-nodes-base.splitOut',
        version: 1,
        position: [-672, -80],
    })
    SplitOutPages = {
        fieldToSplitOut: 'pages',
        options: {},
    };

    @node({
        id: '1718df57-de48-4615-a287-75c0f69dbfc6',
        name: 'Convert to File1',
        type: 'n8n-nodes-base.convertToFile',
        version: 1.1,
        position: [224, -160],
    })
    ConvertToFile1 = {
        operation: 'toBinary',
        sourceProperty: '=b64',
        options: {
            fileName: '={{ $json.filename }}',
            mimeType: '={{ $json.mimeType }}',
        },
    };

    @node({
        id: '231eff3f-dc03-463b-8f45-92bdf9ba703e',
        name: 'Crypto1',
        type: 'n8n-nodes-base.crypto',
        version: 1,
        position: [448, -224],
    })
    Crypto1 = {
        binaryData: true,
        dataPropertyName: 'checksum',
        encoding: 'base64',
    };

    @node({
        id: '7aa38b95-b83f-4d29-b613-b02f7a61c86e',
        name: 'setNewFilename1',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [672, -224],
    })
    Setnewfilename1 = {
        assignments: {
            assignments: [
                {
                    id: '141976fd-4491-49dd-aed0-d283fe69c5bb',
                    name: 'b64urlFilename',
                    value: "={{ $json.checksum.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '') }}.{{ $('parse image json1').item.json.extension }}",
                    type: 'string',
                },
            ],
        },
        includeOtherFields: true,
        options: {},
    };

    @node({
        id: '14e2fb4a-7230-4aca-ac1e-9b037604a223',
        name: 'Merge2',
        type: 'n8n-nodes-base.merge',
        version: 3.2,
        position: [896, -160],
    })
    Merge2 = {
        mode: 'combine',
        combineBy: 'combineByPosition',
        options: {},
    };

    @node({
        id: '189a85c7-5905-483a-bdf6-4d5f3050134b',
        name: 'parse image json1',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [0, -160],
    })
    ParseImageJson1 = {
        assignments: {
            assignments: [
                {
                    id: '84513816-07f8-4ca0-8213-431ba0a28b04',
                    name: 'b64',
                    value: "={{ $json.image_base64.split(',')[1] }}",
                    type: 'string',
                },
                {
                    id: '52526a56-96df-40c7-acb8-1f192517da8f',
                    name: 'mimeType',
                    value: "={{ $json.image_base64.split(';')[0].split(':')[1] }}",
                    type: 'string',
                },
                {
                    id: '2654abf6-9645-4c58-899c-7474665a2ba9',
                    name: 'extension',
                    value: "={{ $json.image_base64.split(';')[0].split(':')[1].split('/')[1] }}",
                    type: 'string',
                },
                {
                    id: '68b81a9d-2d72-446f-8293-7f8718ba5b21',
                    name: 'filename',
                    value: '={{ $json.id }}',
                    type: 'string',
                },
            ],
        },
        options: {},
    };

    @node({
        id: 'f2c7cc13-785d-4555-bf8c-cd5026f23056',
        name: 'forLoopEnd1',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [1344, -160],
    })
    Forloopend1 = {
        assignments: {
            assignments: [
                {
                    id: '645e1715-e5dc-4730-af68-3dba0dfdfa75',
                    name: 'mimeType',
                    value: "={{ $('parse image json1').item.json.mimeType }}",
                    type: 'string',
                },
                {
                    id: '2a484c3e-880e-48b8-8068-8fb33b07989f',
                    name: 'filename',
                    value: "={{ $('Merge2').item.json.b64urlFilename }}",
                    type: 'string',
                },
                {
                    id: '24eb8985-6a94-4500-8d58-0e152307348d',
                    name: 'id',
                    value: "={{ $('parse image json1').item.json.filename }}",
                    type: 'string',
                },
                {
                    id: '40367a4f-7004-485d-bb88-d1d6df0b4a41',
                    name: 'url',
                    value: "=https://stblobpublicaccess.blob.core.windows.net/cdn/{{ $('Merge2').item.json.b64urlFilename }}",
                    type: 'string',
                },
            ],
        },
        options: {},
    };

    @node({
        id: '49435a90-22d7-403a-906a-a633bed0ac87',
        name: 'Aggregate1',
        type: 'n8n-nodes-base.aggregate',
        version: 1,
        position: [1568, -160],
    })
    Aggregate1 = {
        aggregate: 'aggregateAllItemData',
        destinationFieldName: 'images',
        options: {},
    };

    @node({
        id: '38878910-a02b-4122-8517-a2ae2d631add',
        name: 'Merge3',
        type: 'n8n-nodes-base.merge',
        version: 3.2,
        position: [1792, 64],
    })
    Merge3 = {
        mode: 'combine',
        combineBy: 'combineByPosition',
        options: {},
    };

    @node({
        id: '0b77423c-74b9-43b9-b804-d967a29b2cd5',
        name: 'If have image',
        type: 'n8n-nodes-base.if',
        version: 2.2,
        position: [-224, -80],
    })
    IfHaveImage = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 2,
            },
            conditions: [
                {
                    id: '96eee5d6-de82-447f-8a93-25d7d7f04617',
                    leftValue: '={{ $json }}',
                    rightValue: '',
                    operator: {
                        type: 'object',
                        operation: 'notEmpty',
                        singleValue: true,
                    },
                },
            ],
            combinator: 'and',
        },
        options: {},
    };

    @node({
        id: 'b7894f46-36db-4445-9459-9e1516f36f8b',
        name: 'Split Out Image',
        type: 'n8n-nodes-base.splitOut',
        version: 1,
        position: [-448, -80],
        onError: 'continueRegularOutput',
        alwaysOutputData: true,
    })
    SplitOutImage = {
        fieldToSplitOut: 'images',
        options: {},
    };

    @node({
        id: 'a08916b1-7e00-41bc-b0c5-3f4981f68805',
        name: 'Replace image alt text with annotation',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1344, 208],
    })
    ReplaceImageAltTextWithAnnotation = {
        jsCode: `// n8n Function node: update pages[].markdown using image.image_annotation
// Preserves all input fields

function normKey(s) {
  return String(s || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function addKeysForId(map, id, value) {
  if (id == null || value == null) return;
  const raw = String(id).trim();
  if (!raw) return;

  const base = raw.replace(/^.*[\\\\/]/, "");             // last segment if path-like
  const noExt = base.replace(/\\.[a-z0-9]+$/i, "");      // without extension

  const keys = [raw, base, noExt];
  for (const k of keys) {
    const nk = normKey(k);
    if (nk && map[nk] == null) map[nk] = String(value);
  }
}

function collectAnnotations(map, imagesArr) {
  if (!Array.isArray(imagesArr)) return;
  for (const img of imagesArr) {
    if (!img) continue;
    const id = img.id ?? img.image_id ?? img.name ?? img.filename ?? img.file_name;
    const ann = img.image_annotation ?? img.annotation ?? img.alt_text ?? img.caption;
    addKeysForId(map, id, ann);
  }
}

function candidatesFromAltAndSrc(alt, src) {
  const c = [];
  if (alt) c.push(alt, alt.replace(/^.*[\\\\/]/, ""), alt.replace(/\\.[a-z0-9]+$/i, ""));

  if (src) {
    // strip angle brackets and grab url + optional query
    src = src.replace(/^<|>$/g, "");
    const qp = src.match(/[?&](?:id|image_id|imageId)=([^&]+)/i);
    if (qp) c.push(decodeURIComponent(qp[1]));
    const seg = (src.match(/\\/([^\\/?#]+)(?:[?#]|$)/) || [,""])[1] || src; // last segment or whole src
    c.push(seg, seg.replace(/\\.[a-z0-9]+$/i, ""));
  }
  return c;
}

return items.map(item => {
  const pages = Array.isArray(item.json.pages) ? item.json.pages : [];

  // Build a normalized annotation map from top-level and per-page images
  const annMap = Object.create(null);
  collectAnnotations(annMap, item.json.images);
  for (const p of pages) collectAnnotations(annMap, p?.images);

  // Replace alt text in each page's markdown
  for (const page of pages) {
    if (typeof page.markdown !== "string") continue;

    page.markdown = page.markdown.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, (full, alt, srcPart) => {
      const urlMatch = srcPart.match(/^\\s*<?([^\\s'">]+)>?(?:\\s+(['"])(.*)\\2)?\\s*$/);
      const src = urlMatch ? urlMatch[1] : srcPart.trim();
      const title = urlMatch && urlMatch[3] ? \` "\${urlMatch[3]}"\` : "";

      const candidates = candidatesFromAltAndSrc(alt, src);
      for (const cand of candidates) {
        const key = normKey(cand);
        if (key && annMap[key] != null) {
          const newAlt = annMap[key];
          return \`![\${newAlt}](\${src}\${title})\`;
        }
      }
      return full; // no match -> unchanged
    });
  }

  // Mutated in place; keep everything else intact
  item.json.pages = pages;
  return item;
});`,
    };

    @node({
        id: '2056992d-b770-47e1-8a43-654e44097746',
        name: 'Create blob',
        type: 'n8n-nodes-base.azureStorage',
        version: 1,
        position: [1120, -160],
    })
    CreateBlob = {
        resource: 'blob',
        operation: 'create',
        container: {
            __rl: true,
            value: 'cdn',
            mode: 'list',
            cachedResultName: 'cdn',
        },
        blobCreate: '={{ $json.b64urlFilename }}',
        options: {
            contentMd5: '={{ $json.checksum }}',
            contentType: "={{ $('parse image json1').item.json.mimeType }}",
        },
        requestOptions: {},
    };

    @node({
        id: '8b97ff29-8b76-46e1-8fd6-17e75f8e691d',
        name: 'Replace image url',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [2016, 64],
    })
    ReplaceImageUrl = {
        jsCode: `// Expects each item to have:
//   json.text: string
//   json.images: Array<{ id: string, url: string }>
const items = $input.all();

function buildIdToUrl(images) {
  const map = new Map();
  for (const img of images || []) {
    if (!img?.id || !img?.url) continue;
    map.set(String(img.id).toLowerCase(), String(img.url));
  }
  return map;
}

function replaceRefs(text, idToUrl) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;

  // 1) Markdown link/image: replace (img-0.jpeg) -> (https://...)
  out = out.replace(/\\(\\s*(img-[^) \\t\\r\\n]+)\\s*\\)/gi, (m, id) => {
    const url = idToUrl.get(id.toLowerCase());
    return url ? \`(\${url})\` : m;
  });

  // 2) HTML <img src="img-0.jpeg"> -> <img src="https://...">
  out = out.replace(/(<img\\b[^>]*\\bsrc=["'])(img-[^"']+)(["'][^>]*>)/gi, (m, p1, id, p3) => {
    const url = idToUrl.get(id.toLowerCase());
    return url ? \`\${p1}\${url}\${p3}\` : m;
  });

  // 3) Fallback: standalone IDs in text -> URL (only whole-token matches)
  out = out.replace(/\\b(img-[a-z0-9_.-]+\\.(?:png|jpe?g|gif|webp|bmp|svg))\\b/gi, (m, id) => {
    const url = idToUrl.get(id.toLowerCase());
    return url || m;
  });

  return out;
}

return items.map(({ json, ...rest }) => {
  const idToUrl = buildIdToUrl(json.images);
  return {
    json: {
      ...json,
      text: replaceRefs(json.text, idToUrl),
    },
    ...rest,
  };
});`,
    };

    @node({
        id: 'ec2ba33c-0fa3-4d3f-9e01-aa593c90b4c9',
        name: 'Merge pages',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1568, 208],
    })
    MergePages = {
        mode: 'runOnceForEachItem',
        jsCode: `// Combine all \`markdown\` strings from the current item's \`pages\` array
// Output only one field: { markdown: "<combined text>" }

const pages = $json.pages;

const combined = Array.isArray(pages)
  ? pages
      .map((p, index) => {
        const text = typeof p?.markdown === 'string' ? p.markdown.trim() : '';
        // Only append the page marker if there is actual text on the page
        return text ? \`<--Page: \${index + 1}-->\\n\${text}\` : '';
      })
      .filter(s => s !== '') // Remove any empty entries from the array
      .join('\\n\\n')
  : '';

return { markdown: combined };`,
    };

    @node({
        id: 'fc688ca1-fb83-433a-8a1e-ea21c4577721',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [176, 1008],
    })
    AiAgent = {
        options: {},
    };

    @node({
        id: 'd4d2052f-2bbf-4aca-958f-382c2da5002d',
        name: 'Embeddings Azure OpenAI',
        type: '@n8n/n8n-nodes-langchain.embeddingsAzureOpenAi',
        version: 1,
        position: [1152, 768],
    })
    EmbeddingsAzureOpenai = {
        options: {},
    };

    @node({
        id: '018fa48f-c8d6-433a-ab14-aa2a56b51008',
        name: 'Hybrid search documents',
        type: 'CUSTOM.cosmosDb',
        version: 1,
        position: [-288, 656],
        credentials: { cosmosDbApi: { id: 'xDWB3zRdF4Cz1Rcc', name: 'Cosmos DB account' } },
    })
    HybridSearchDocuments = {
        operation: 'hybridSearch',
    };

    @node({
        id: 'a6d55488-3355-488a-86e6-d5b95b69a736',
        name: 'Select documents in Cosmos DB',
        type: 'CUSTOM.cosmosDbTool',
        version: 1,
        position: [160, 1248],
        credentials: { cosmosDbApi: { id: 'xDWB3zRdF4Cz1Rcc', name: 'Cosmos DB account' } },
    })
    SelectDocumentsInCosmosDb = {
        operation: 'hybridSearch',
        descriptionType: 'manual',
        toolDescription: 'Cosmos DB retrieval tool for AI Agent workflows',
        databaseName: 'ccmrchatbot',
        containerName: 'test',
        keyword: 'equipment',
        searchQuery: 'equipment',
        partitionKeyValue: '=website',
        additionalFilters: '=',
        fieldsToReturn: '=',
    };

    @node({
        id: '36e40473-b640-4b39-9e8c-01e0c26cc362',
        name: 'Embeddings OpenAI',
        type: '@n8n/n8n-nodes-langchain.embeddingsOpenAi',
        version: 1.2,
        position: [208, 1456],
        credentials: { openAiApi: { id: 'ROpITb6KJDZ0hzMw', name: 'OpenAi account' } },
    })
    EmbeddingsOpenai = {
        options: {},
    };

    @node({
        id: '5f2e1110-87f8-4a86-9f60-61fd836f4489',
        name: 'When clicking ‘Execute workflow’',
        type: 'n8n-nodes-base.manualTrigger',
        version: 1,
        position: [-336, 1008],
    })
    WhenClickingExecuteWorkflow = {};

    @node({
        id: '1339c675-0f11-4f1d-96d7-3e8dda44505b',
        name: 'Edit Fields',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [-128, 1008],
    })
    EditFields = {
        assignments: {
            assignments: [
                {
                    id: '03393a30-2ed9-4597-9bc8-c799a3890a9c',
                    name: 'chatInput',
                    value: 'use hybrid search tool to find the equipment of ccmr',
                    type: 'string',
                },
                {
                    id: '69a34c1d-9415-4087-b34b-8f7141d58dcf',
                    name: 'sessionId',
                    value: '123',
                    type: 'string',
                },
            ],
        },
        options: {},
    };

    @node({
        id: '8ab9bf49-f343-40b5-a177-6c2f6947b1c7',
        name: 'OpenAI Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.3,
        position: [0, 1232],
        credentials: { openAiApi: { id: 'ROpITb6KJDZ0hzMw', name: 'OpenAi account' } },
    })
    OpenaiChatModel = {
        model: {
            __rl: true,
            value: '=gpt-4o-mini',
            mode: 'id',
        },
        responsesApiEnabled: false,
        options: {},
    };

    @node({
        id: 'b405f749-8e8c-41eb-acad-f83345b2c637',
        name: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.4,
        position: [656, 1200],
    })
    HttpRequest = {
        url: "={{ $fromAI('URL', ``, 'string') }}",
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.OnFormSubmission.out(0).to(this.UploadPdf.in(0));
        this.UploadPdf.out(0).to(this.GetUrl.in(0));
        this.GetUrl.out(0).to(this.GetDocument.in(0));
        this.GetDocument.out(0).to(this.SplitOutPages.in(0));
        this.GetDocument.out(0).to(this.ReplaceImageAltTextWithAnnotation.in(0));
        this.SplitOutPages.out(0).to(this.SplitOutImage.in(0));
        this.ConvertToFile1.out(0).to(this.Crypto1.in(0));
        this.ConvertToFile1.out(0).to(this.Merge2.in(1));
        this.Crypto1.out(0).to(this.Setnewfilename1.in(0));
        this.Setnewfilename1.out(0).to(this.Merge2.in(0));
        this.Merge2.out(0).to(this.CreateBlob.in(0));
        this.ParseImageJson1.out(0).to(this.ConvertToFile1.in(0));
        this.Forloopend1.out(0).to(this.Aggregate1.in(0));
        this.Aggregate1.out(0).to(this.Merge3.in(0));
        this.Merge3.out(0).to(this.ReplaceImageUrl.in(0));
        this.IfHaveImage.out(0).to(this.ParseImageJson1.in(0));
        this.IfHaveImage.out(1).to(this.Merge3.in(0));
        this.SplitOutImage.out(0).to(this.IfHaveImage.in(0));
        this.ReplaceImageAltTextWithAnnotation.out(0).to(this.MergePages.in(0));
        this.CreateBlob.out(0).to(this.Forloopend1.in(0));
        this.MergePages.out(0).to(this.Merge3.in(1));
        this.WhenClickingExecuteWorkflow.out(0).to(this.EditFields.in(0));
        this.EditFields.out(0).to(this.AiAgent.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.OpenaiChatModel.output,
            ai_tool: [this.SelectDocumentsInCosmosDb.output, this.HttpRequest.output],
        });
        this.SelectDocumentsInCosmosDb.uses({
            ai_embedding: this.EmbeddingsOpenai.output,
        });
    }
}
