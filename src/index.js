import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { connectEngine } from './engine.js'
import { focusedTools } from './model-tools.js'
import { ARTIFACT_PREFIX, EXAMPLE_IDS, FRAME_URI, isViewerId, PLUGIN_ID, ROUTE, sessionFile, TOOL } from './workbench-contract.js'

const OPEN = 'sequence.open_from_chat'
const ACQUIRE = 'sequence.acquire_public_example'
const RESTORE = 'sequence.restore_chat_viewer_session'
const LIFECYCLE = 'sequence.get_viewer_lifecycle'
const SOURCE_META = 'openai/viewerFile'
const CONTEXT = 'sequence.get_context'
const ANALYZE = 'sequence.run_analysis'
const ALIGN = 'sequence.align'
const SEARCH_DOCUMENT = 'sequence.search_document'
const LOAD_TRACK = 'sequence.load_track'
const EXPORT_ARTIFACT = 'sequence.export_artifact'
const operationNotes = {
  [ANALYZE]: 'For translate, use a signed frame (1, 2, 3, -1, -2, or -3). The strands option is for find-orfs.',
  [SEARCH_DOCUMENT]: 'documentId is required. Run sequence.list_documents in the same viewer and pass an exact returned documentId.',
  'sequence.control_viewer': 'set_sequence_view_options merges supplied fields into the current display. wrapWidth selects a fixed width (40, 50, 60, or 80).',
}
const MAX_REQUEST = 24 * 1024 * 1024
const MAX_VIEWERS = 256

const workspaceWriters = new Set([
  'sequence.create_workspace_export_directory', 'sequence.prepare_workspace_export',
  'sequence.generate_workspace_export',
])
const uploads = new Set(['sequence.append_workbench_payload_chunk', 'sequence.finish_workbench_payload_upload'])
const excludedAppTools = new Set([OPEN, ACQUIRE, 'sequence.open', 'sequence.register_viewer_session'])
const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; worker-src blob:; font-src data:; media-src blob: data:; base-uri 'none'; form-action 'none'; sandbox allow-scripts"

function errorText(error) { return error instanceof Error ? error.message : String(error) }
function textResult(result) { return result.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '' }
function assertResult(result) {
  if (result.isError) throw new Error(textResult(result) || 'Sequence workbench operation failed.')
  return result
}

function digest(value) { return createHash('sha256').update(value).digest('hex') }
function canUse(tool, audience) { return tool?._meta?.ui?.visibility?.includes(audience) }
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function readRequest(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Expected application/json.')
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > MAX_REQUEST) throw new Error('Sequence workbench request exceeds the transfer limit.')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks, length).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  return value
}

function within(root, file) {
  const path = relative(root, file)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

async function localFile(root, path) {
  if (typeof path !== 'string' || !path || /[\u0000\r\n]|^[a-z]+:\/\//iu.test(path)) throw new Error('Choose a workspace file.')
  const canonical = await realpath(resolve(root, path))
  if (!within(root, canonical) || !(await stat(canonical)).isFile()) throw new Error('The file is outside this DSH workspace.')
  return canonical
}

async function verifyTrackFiles(root, parameters) {
  const { format, path, indexPath, referencePath } = parameters
  if (path !== undefined) await localFile(root, path)
  if (referencePath !== undefined) await localFile(root, referencePath)
  if (format !== 'bam' && format !== 'cram') {
    if (indexPath !== undefined) await localFile(root, indexPath)
    return
  }
  const extension = format === 'bam' ? 'bai' : 'crai'
  const index = indexPath ?? `${path}.${extension}`
  try {
    await localFile(root, index)
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    const label = format.toUpperCase()
    const choices = format === 'bam' ? 'a BAI or CSI index' : 'a CRAI index'
    const filename = typeof path === 'string' ? basename(path) : label
    const detail = indexPath === undefined
      ? `Place ${filename}.${extension} next to the ${label} file or pass indexPath for ${choices} in the workspace.`
      : `Check indexPath (${basename(index)}) and choose ${choices} in the workspace.`
    throw new Error(`Missing ${label} index for ${filename}. ${detail}`)
  }
}

function mayReadResource(record, uri) {
  return uri === sourceUri(record) || (typeof uri === 'string' && uri.startsWith(ARTIFACT_PREFIX) && isViewerId(uri.slice(ARTIFACT_PREFIX.length)))
}
function sourceUri(record) { return record.presentation._meta[SOURCE_META].primaryFile.uri }
function scene(record) { return { id: record.id, title: record.title, placement: record.placement, placementRevision: record.placementRevision ?? 0 } }
function viewerCandidate(record) {
  return {
    ...scene(record), viewerId: record.id, native: record.native,
    ...(record.path ? { path: relative(record.root, record.path) } : {}),
    ...(record.exampleId ? { exampleId: record.exampleId } : {}),
  }
}

class AmbiguousViewerError extends Error {
  constructor(records) {
    super('Several Sequence viewers are available. Match the requested file path or example ID to a viewerId below, or ask which viewer to use.')
    this.viewers = records.map(viewerCandidate)
  }
}

function qualified(result) {
  return {
    ok: !result.isError && result.structuredContent?.applied !== false,
    summary: textResult(result) || result.structuredContent?.message || 'Sequence operation completed.',
    ...(result.structuredContent == null ? {} : { data: result.structuredContent }),
  }
}

const toolDefinition = {
  name: TOOL,
  description: [
    'Use this for viewer discovery, readiness, workbench analysis, and advanced operations. Prefer sequence_open, sequence_read_selection, sequence_find_features, sequence_set_display and sequence_export for their specific tasks.',
    'Use action open with a workspace-relative path, or action examples then open with one exact exampleId for pinned public data.',
    'After open, action wait confirms rendering. Use context before interpreting a current user selection. If the user supplied a viewer ID in a selection reference, use that exact ID.',
    'Use actions viewers, operations and help to discover viewers and argument schemas; action run takes operation and arguments.',
    'Operations include sequence.get_context, sequence.query_viewer, sequence.control_viewer, sequence.list_documents, sequence.read_document, sequence.search_document, sequence.read_source, sequence.run_analysis, sequence.align, sequence.edit_copy, sequence.manage_annotations, sequence.load_track, sequence.export_artifact, sequence.save_session, sequence.restore_session and sequence.cancel_job.',
    'Use the viewerId from open or context for follow-up calls. Several viewers require an explicit ID. A sessionId returned by context is accepted for the same viewer. After starting an analysis, use data.jobId to query jobs and verify completion. Built-in alignments and guide trees are exploratory.',
  ].join(' '),
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['open', 'viewers', 'operations', 'help', 'status', 'wait', 'context', 'run', 'examples', 'move'] },
      path: { type: 'string' },
      exampleId: { type: 'string', enum: EXAMPLE_IDS },
      viewerId: { type: 'string', description: 'DSH viewer ID returned by open or context. Also accepts the engine sessionId returned by context.' },
      sessionId: { type: 'string', description: 'Alias for an engine sessionId returned by context. Use a viewer from the current conversation.' },
      operation: { type: 'string' },
      arguments: { type: 'object', additionalProperties: true },
      placement: { type: 'string', enum: ['inline', 'sidebar'] },
      presentation: { type: 'string', enum: ['full', 'inline'] },
    },
  },
  output: {
    schema: {
      type: 'object', required: ['ok', 'summary'], additionalProperties: true,
      properties: {
        ok: { type: 'boolean' }, summary: { type: 'string' },
        scene: { type: 'object', additionalProperties: true }, data: { type: 'object', additionalProperties: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.data ? `${value.summary}\n${JSON.stringify(value.data)}` : value.summary }],
    presentationMeta: (_args, value) => ({ plugin: PLUGIN_ID, scene: value.scene ?? null }),
  },
}

export const inject = ['tools', 'webServer', 'connection', 'agents', 'sessions', 'workspaceFiles', 'sandboxPolicy']

export function apply(ctx) {
  const state = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'), 'cache', PLUGIN_ID)
  const engines = new Map()
  const pending = new Map()
  const uploadTargets = new Map()
  const transfers = new Map()

  ctx.inject(['skills'], skillContext => {
    const content = readFileSync(new URL('../skills/sequence-viewer/SKILL.md', import.meta.url), 'utf8')
    skillContext.skills.register({
      name: 'dsh-sequence-viewer',
      description: 'Choose the right tools for live biological sequence or alignment files, selections, annotation lookup, display controls, analysis, and exports in DSH.',
      source: 'bundled',
      content,
    })
  })

  function ownerDirectory(owner) { return join(state, digest(owner)) }
  function viewerDirectory(owner, id) { return join(ownerDirectory(owner), id) }

  async function authority(owner, signal, agent = ctx.agents.get(owner)) {
    if (typeof owner !== 'string' || !owner || owner.length > 256) throw new Error('Open a DSH conversation first.')
    const session = agent?.session ?? ctx.sessions.get(owner)
    const stored = session ? null : await ctx.get('sessionPersistence')?.stat(owner)
    const header = session?.header ?? stored?.header
    if (!header) throw new Error('Open the owning DSH conversation.')
    const cwd = header.cwd ?? ctx.sandboxPolicy.workspaceRoot
    const root = await realpath(cwd)
    if (!(await stat(root)).isDirectory()) throw new Error('A local DSH workspace is required.')
    signal?.throwIfAborted()
    return { owner, root, session }
  }

  function requireWrite(auth) {
    if (!auth.session || ctx.sandboxPolicy.resolve({ session: auth.session }).mode === 'read-only') {
      throw new Error('The DSH session is read-only for workspace files.')
    }
  }

  function engineFor(auth, id) {
    const directory = join(viewerDirectory(auth.owner, id), 'engine')
    let promise = engines.get(directory)
    if (!promise) {
      const workspaceState = join(ownerDirectory(auth.owner), `workspace-${digest(auth.root)}`)
      promise = connectEngine(auth.root, workspaceState)
      engines.set(directory, promise)
      void promise.catch(() => engines.delete(directory))
    }
    return promise
  }

  async function readRecord(auth, id) {
    if (!isViewerId(id)) throw new Error('Unknown sequence viewer ID.')
    const file = join(viewerDirectory(auth.owner, id), 'viewer.json')
    const record = JSON.parse(await readFile(file, 'utf8'))
    if (record.id !== id || record.owner !== auth.owner || record.root !== auth.root) {
      throw new Error('The viewer is unavailable in this conversation or workspace.')
    }
    return record
  }

  async function listRecords(auth) {
    const entries = await readdir(ownerDirectory(auth.owner)).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const records = await Promise.all(entries.filter(isViewerId).map(id => readRecord(auth, id).catch(() => null)))
    return records.filter(Boolean).sort((a, b) => b.openedAt - a.openedAt)
  }

  async function resolveModelViewer(auth, args) {
    const references = [...new Set([args.viewerId, args.sessionId, args.arguments?.sessionId]
      .filter(id => id !== undefined))]
    if (references.length === 0) {
      const records = await listRecords(auth)
      if (records.length > 1) throw new AmbiguousViewerError(records)
      return records[0]
    }
    if (references.some(id => !isViewerId(id))) throw new Error('Provide a valid viewerId or sessionId.')
    if (references.length === 1) {
      const record = await readRecord(auth, references[0]).catch(error => {
        if (error.code !== 'ENOENT') throw error
        return null
      })
      if (record) return record
    }
    const records = await listRecords(auth)
    const matches = references.map(id => records.find(record => record.id === id || record.sessionId === id))
    if (matches.some(record => !record)) throw new Error('The viewer is unavailable in this conversation or workspace.')
    if (matches.some(record => record.id !== matches[0].id)) {
      throw new Error('viewerId and sessionId refer to different viewers.')
    }
    return matches[0]
  }

  async function saveRecord(record) {
    const dir = viewerDirectory(record.owner, record.id)
    const temp = join(dir, `${randomUUID()}.tmp`)
    try {
      await writeFile(temp, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
      await rename(temp, join(dir, 'viewer.json'))
    } finally {
      await rm(temp, { force: true })
    }
  }

  async function allocate(auth, { path, exampleId, placement = 'inline', presentation, version, native = false }, signal) {
    signal?.throwIfAborted()
    if (Boolean(path) === Boolean(exampleId)) throw new Error('Supply exactly one file path or public example ID.')
    if (exampleId) {
      if (!EXAMPLE_IDS.includes(exampleId)) throw new Error('Unknown public sequence example.')
      requireWrite(auth)
    }
    const owned = await listRecords(auth)
    if (owned.length >= MAX_VIEWERS) throw new Error(`This conversation has reached its ${MAX_VIEWERS}-viewer limit.`)
    const id = randomUUID()
    const directory = viewerDirectory(auth.owner, id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      const engine = await engineFor(auth, id)
      const result = assertResult(await engine.call(exampleId ? ACQUIRE : OPEN, exampleId
        ? { exampleId }
        : { path, ...(presentation ? { presentation } : {}) }, signal))
      const { viewerSessionId } = result.structuredContent
      const title = result._meta?.[SOURCE_META]?.primaryFile?.name
      if (!isViewerId(viewerSessionId) || !title) throw new Error('The engine did not return a mounted-source capability.')
      const record = {
        id, owner: auth.owner, root: auth.root, path, version, placement, title, native,
        openedAt: Date.now(), sessionId: viewerSessionId, presentation: result, ...(exampleId ? { exampleId } : {}),
      }
      await saveRecord(record)
      return record
    } catch (error) {
      const key = join(directory, 'engine')
      const engine = await engines.get(key)?.catch(() => null)
      engines.delete(key)
      await engine?.close()
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async function lifecycle(engine, record, signal) {
    return qualified(await engine.call(LIFECYCLE, { sessionId: record.sessionId }, signal))
  }

  function serializedTransfer(record, operation) {
    const before = transfers.get(record.id) ?? Promise.resolve()
    const current = before.catch(() => {}).then(operation)
    transfers.set(record.id, current)
    void current.finally(() => {
      if (transfers.get(record.id) === current) transfers.delete(record.id)
    }).catch(() => {})
    return current
  }

  async function relocate(auth, record, placement, signal) {
    if (!['inline', 'sidebar'].includes(placement)) throw new Error('Choose inline or sidebar.')
    if (record.native) throw new Error('Use Open in chat with the workspace path to create a movable chat viewer.')
    return serializedTransfer(record, async () => {
      const latest = await readRecord(auth, record.id)
      if (latest.placement === placement) return latest
      const engine = await engineFor(auth, record.id)
      const status = await lifecycle(engine, latest, signal)
      let resumeId = latest.resumeId
      if (status.data?.status === 'ready' && !resumeId) {
        const saved = qualified(await engine.call('sequence.save_session', { sessionId: latest.sessionId }, signal))
        resumeId = saved.data?.result?.savedSessionId
        if (!saved.ok && /^Workbench session exceeds (?:the [\d,]+-byte session budget|the bounded session size)\./u.test(saved.summary)) {
          // The source-bound checkpoint records view state and edits relative to the unchanged source.
          // Wait for its acknowledgement before the current frame is unmounted.
          const checkpoint = await engine.flushCheckpoint(latest.sessionId)
          if (!checkpoint.applied) throw new Error(checkpoint.message)
        } else if (!saved.ok || !isViewerId(resumeId)) {
          throw new Error(saved.summary)
        }
      }
      signal?.throwIfAborted()
      const updated = { ...latest, placement, resumeId, placementRevision: (latest.placementRevision ?? 0) + 1 }
      await saveRecord(updated)
      return updated
    })
  }

  async function completeRelocation(auth, record, signal) {
    if (!record.resumeId) return { ok: true }
    return serializedTransfer(record, async () => {
      const latest = await readRecord(auth, record.id)
      if (!latest.resumeId) return { ok: true }
      const engine = await engineFor(auth, record.id)
      const deadline = Date.now() + 15_000
      while (true) {
        const lifecycleResult = await lifecycle(engine, latest, signal)
        if (lifecycleResult.data?.status === 'ready') break
        if (lifecycleResult.data?.status !== 'loading' || Date.now() >= deadline) {
          throw new Error('The viewer has not mounted. Reopen it to resume the saved state.')
        }
        await delay(200, undefined, { signal })
      }
      const restored = assertResult(await engine.call('sequence.restore_session', {
        sessionId: latest.sessionId, savedSessionId: latest.resumeId,
      }, signal))
      if (!restored.structuredContent?.applied) {
        throw new Error(restored.structuredContent?.message ?? 'The saved viewer state could not be restored.')
      }
      await saveRecord({ ...latest, resumeId: undefined })
      return { ok: true }
    })
  }

  async function setup(auth, record, signal) {
    const engine = await engineFor(auth, record.id)
    const restored = assertResult(await engine.call(RESTORE, {
      resourceUri: sourceUri(record), sessionId: record.sessionId,
    }, signal))
    return {
      scene: scene(record), viewerSessionId: record.sessionId,
      result: { ...record.presentation, _meta: { ...record.presentation._meta, ...restored._meta } },
    }
  }

  async function preview(auth, body, signal) {
    const file = sessionFile(body.address)
    if (!file || file.sessionId !== auth.owner) throw new Error('Invalid session resource address.')
    const path = await localFile(auth.root, file.path)
    const { version } = await ctx.workspaceFiles.stat({ sessionId: auth.owner, workspaceRoot: auth.root }, path, signal)
    const key = JSON.stringify([auth.owner, path, version])
    let promise = pending.get(key)
    if (!promise) {
      promise = (async () => {
        const record = (await listRecords(auth)).find(view => view.native && view.path === path && view.version === version)
          ?? await allocate(auth, { path, version, placement: 'sidebar', presentation: 'full', native: true }, signal)
        return { ...await setup(auth, record, signal), version }
      })()
      pending.set(key, promise)
      void promise.finally(() => pending.delete(key)).catch(() => {})
    }
    return promise
  }

  async function rendererRpc(auth, record, body, signal) {
    const engine = await engineFor(auth, record.id)
    if (body.method === 'resources/read' && mayReadResource(record, body.params?.uri)) {
      return engine.request(body.method, { uri: body.params.uri }, signal)
    }
    const { name, arguments: input } = body.params ?? {}
    const args = input ?? {}
    if (body.method !== 'tools/call' || !canUse(engine.tools.get(name), 'app') || excludedAppTools.has(name)) {
      throw new Error('Unsupported sequence renderer operation.')
    }
    if (args.sessionId !== undefined && args.sessionId !== record.sessionId) throw new Error('The request belongs to another viewer.')
    if (args.resourceUri !== undefined && args.resourceUri !== sourceUri(record)) throw new Error('The request belongs to another source.')
    if (workspaceWriters.has(name) || args.destination?.kind === 'workspace') requireWrite(auth)
    const uploadKey = `${record.id}:${args.uploadId}`
    if (uploads.has(name) && uploadTargets.get(uploadKey) !== 'private') requireWrite(auth)
    // Remounts reuse the same signed source and command session. The engine expires unmounted sessions.
    if (name === 'sequence.close_viewer_session') return { content: [] }
    const result = await engine.call(name, args, signal)
    if (!result.isError && name === 'sequence.begin_workbench_payload_upload') {
      if (uploadTargets.size >= 128) uploadTargets.delete(uploadTargets.keys().next().value)
      uploadTargets.set(uploadKey, args.destination?.kind ?? 'private')
    }
    if (name === 'sequence.finish_workbench_payload_upload' || name === 'sequence.abort_workbench_payload_upload') {
      uploadTargets.delete(uploadKey)
    }
    return result
  }

  async function model(args, exec) {
    if (!exec.agent) throw new Error('Sequence workbench tools require an owning DSH conversation.')
    const { signal } = exec
    const auth = await authority(exec.agent.id, signal, exec.agent)
    const action = args.action ?? (args.operation ? 'run' : 'context')
    if (action === 'examples') {
      return { ok: true, summary: 'Pinned public Sequence Viewer examples.', data: { examples: EXAMPLE_IDS.map(id => ({ id, prompt: starterPrompts[id] })) } }
    }
    if (action === 'operations' || action === 'help') {
      const engine = await engineFor(auth, 'catalog')
      const tools = [...engine.tools.values()].filter(tool => canUse(tool, 'model') && ![OPEN, ACQUIRE, 'sequence.list_viewers'].includes(tool.name))
      if (action === 'help') {
        const selected = tools.find(tool => tool.name === args.operation)
        if (!selected) throw new Error('Unknown model-facing sequence operation.')
        return { ok: true, summary: [operationNotes[selected.name], selected.description].filter(Boolean).join(' '), data: { name: selected.name, inputSchema: selected.inputSchema } }
      }
      return { ok: true, summary: 'Sequence workbench operations.', data: { operations: tools.map(({ name, title }) => ({ name, title: title ?? name })) } }
    }
    if (action === 'open') {
      if (Boolean(args.path) === Boolean(args.exampleId)) throw new Error('Supply exactly one workspace path or public example ID.')
      const path = args.path === undefined ? undefined : await localFile(auth.root, args.path)
      const version = path && (await ctx.workspaceFiles.stat({ sessionId: auth.owner, workspaceRoot: auth.root }, path, signal)).version
      const record = await allocate(auth, { ...args, path, version }, signal)
      return {
        ok: true, summary: 'Sequence viewer is opening. Use wait to confirm rendering before issuing controls.',
        scene: scene(record), data: {
          viewerId: record.id, viewerReady: false, sessionReady: true, placement: record.placement,
          nextAction: { tool: TOOL, arguments: { action: 'wait', viewerId: record.id } },
          ...(record.exampleId ? { provenance: record.presentation.structuredContent.publicExampleProvenance, workflow: starterPrompts[record.exampleId] } : {}),
        },
      }
    }
    if (action === 'viewers') {
      return { ok: true, summary: 'Viewers in the active DSH conversation.', data: { viewers: (await listRecords(auth)).map(viewerCandidate) } }
    }
    const record = await resolveModelViewer(auth, args)
    if (!record) throw new Error('Open a sequence viewer first, or supply its viewer ID.')
    if (action === 'move') {
      const moved = await relocate(auth, record, args.placement, signal)
      return { ok: true, summary: 'Requested viewer placement.', scene: scene(moved), data: { viewerId: moved.id, placement: moved.placement } }
    }
    const engine = await engineFor(auth, record.id)
    if (action === 'status' || action === 'wait') {
      const deadline = Date.now() + (action === 'wait' ? 12_000 : 0)
      let status
      do {
        status = await lifecycle(engine, record, signal)
        if (status.data?.status !== 'loading' || Date.now() >= deadline) break
        await delay(200, undefined, { signal })
      } while (true)
      return { ...status, data: { ...status.data, viewerReady: status.data?.status === 'ready', viewerId: record.id } }
    }
    const operation = action === 'context' ? CONTEXT : args.operation
    if (!canUse(engine.tools.get(operation), 'model') || [OPEN, ACQUIRE, 'sequence.list_viewers'].includes(operation)) {
      throw new Error('Choose a model-facing operation returned by operations.')
    }
    const parameters = { ...args.arguments, sessionId: record.sessionId }
    if (operation === ANALYZE && parameters.analysis === 'translate' && parameters.strands !== undefined) {
      throw new Error(operationNotes[ANALYZE])
    }
    if (operation === SEARCH_DOCUMENT && (typeof parameters.documentId !== 'string' || !parameters.documentId.trim())) {
      throw new Error(operationNotes[SEARCH_DOCUMENT])
    }
    if (operation === LOAD_TRACK) await verifyTrackFiles(auth.root, parameters)
    if (operation === EXPORT_ARTIFACT && parameters.destination?.kind === 'workspace') requireWrite(auth)
    const result = qualified(await engine.call(operation, parameters, signal))
    const data = { ...result.data, viewerId: record.id, operation }
    if ((operation === ANALYZE || operation === ALIGN) && isViewerId(data.result?.id)) {
      data.jobId = data.result.id
      data.jobStatus = data.result.status
    }
    if (operation === EXPORT_ARTIFACT && result.ok && result.data?.result?.outputWorkspacePath) {
      const summary = `Published to workspace: ${result.data.result.outputWorkspacePath}.`
      return { ...result, summary, data: { ...data, message: summary } }
    }
    return { ...result, data }
  }

  const disposeTools = [toolDefinition, ...focusedTools].map(({ mapInput, ...definition }) =>
    ctx.tools.register({
      ...definition,
      output: toolDefinition.output,
      execute: async (args, exec) => {
        try { return await model(mapInput ? mapInput(args) : args, exec) }
        catch (error) {
          const response = { ok: false, summary: errorText(error) }
          if (error instanceof AmbiguousViewerError) {
            response.data = { code: 'ambiguous_viewer', viewers: error.viewers }
          }
          return response
        }
      },
    }))

  ctx.effect(() => {
    const disposeFrame = ctx.webServer.register({
      kind: 'prefix', path: `${ROUTE}/frame`,
      resource: async (request, peer) => {
        try {
          if (peer?.principal && peer.principal.kind !== 'owner') return json({ error: 'Owner access required.' }, 403)
          const rejection = peer ? undefined : ctx.connection.requestRejection(request)
          if (rejection !== undefined) return json({ error: 'Authenticate in DSH first.' }, rejection)
          const [, owner, id, extra] = new URL(request.url).pathname.slice(`${ROUTE}/frame`.length).split('/')
          if (!owner || !id || extra !== undefined) return json({ error: 'Unknown viewer frame.' }, 404)
          const auth = await authority(decodeURIComponent(owner), request.signal)
          const record = await readRecord(auth, id)
          const engine = await engineFor(auth, record.id)
          const result = await engine.request('resources/read', { uri: FRAME_URI }, request.signal)
          const html = record.native
            ? result.contents[0].text.replace('</head>', '<style>.sequence-reviewed-host-action{display:none!important}</style></head>')
            : result.contents[0].text
          return new Response(html, { headers: {
            'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
            'content-security-policy': CSP, 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
          } })
        } catch (error) { return json({ error: errorText(error) }, 400) }
      },
    })
    const disposeApi = ctx.webServer.register({
      kind: 'exact', path: `${ROUTE}/api`,
      handler: async (request, response) => {
        const controller = new AbortController()
        response.once('close', () => controller.abort())
        const { signal } = controller
        async function run() {
          const rejection = ctx.connection.requestRejection(request)
          if (rejection !== undefined) return json({ error: 'Authenticate in DSH first.' }, rejection)
          if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
          const body = await readRequest(request)
          const auth = await authority(body.owner, signal)
          if (body.action === 'preview') return json(await preview(auth, body, signal))
          const record = await readRecord(auth, body.viewerId)
          if (body.action === 'setup') return json(await setup(auth, record, signal))
          if (body.action === 'selection') {
            const engine = await engineFor(auth, record.id)
            const result = assertResult(await engine.call(CONTEXT, {
              sessionId: record.sessionId, scope: 'selection', sections: ['overview', 'selection'],
            }, signal))
            const { status, revision, sections } = result.structuredContent
            if (status !== 'ready') throw new Error('This viewer is still loading.')
            const target = sections?.selection?.activeTarget
            if (!target) throw new Error('Select a sequence range, feature, or alignment cell first.')
            // Send only coordinates and identity. The model can query the owning viewer on demand.
            const { kind, start, end, row, column, record: sequenceRecord } = target
            return json({
              title: record.title, contextRevision: revision, target: { kind, start, end, row, column, record: sequenceRecord },
            })
          }
          if (body.action === 'placement') return json({ scene: scene(await relocate(auth, record, body.placement, signal)) })
          if (body.action === 'resume') return json(await completeRelocation(auth, record, signal))
          if (body.action === 'rpc') return json({ result: await rendererRpc(auth, record, body, signal) })
          return json({ error: 'Unknown sequence workbench operation.' }, 400)
        }
        const result = await run().catch(error => json({ error: errorText(error) }, 400))
        if (!signal.aborted) {
          response.writeHead(result.status, Object.fromEntries(result.headers))
          response.end(await result.text())
        }
      },
    })
    return () => {
      disposeFrame()
      disposeApi()
      for (const engine of engines.values()) void engine.then(value => value.close()).catch(() => {})
      engines.clear()
      uploadTargets.clear()
      for (const dispose of disposeTools) if (typeof dispose === 'function') dispose()
    }
  })
}

const starterPrompts = {
  'ena-drr037765-first-500': 'Open the verified ENA subset. Use live quality summary and run quality-report if detailed read distributions are requested. Report loaded read count, length range, GC, Q30 and subset provenance.',
  'uniprot-human-ras-sv1': 'Use the verified alignment, select P01116 as reference, compare conserved motifs and tails, run a distance matrix and exploratory neighbor-joining guide tree, and export Newick with provenance when requested.',
  'ncbi-nc-001416-1': 'Open the verified annotated GenBank record. Use the live feature index to inspect the annotated cI region and its strand and verify its genetic-code-aware translation against the reference annotation.',
  'rfam-rf00360-15-1': 'Open the version-pinned Rfam Stockholm seed alignment and compare conservation across its rows.',
}
