import { pathToFileURL } from 'node:url'
import manifest from '../package.json' with { type: 'json' }
import { createSequenceViewerServer } from '../lib/sequence-viewer/server.mjs'

const logger = { info() {}, error() {}, warn() {}, async flush() {} }

export async function connectEngine(root, stateDirectory) {
  const server = createSequenceViewerServer({ logger, stateDirectory })
  let nextId = 0
  const pending = new Map()
  const transport = {
    async start() {},
    async send(message) {
      if (message.method === 'roots/list') {
        queueMicrotask(() => transport.onmessage({
          jsonrpc: '2.0', id: message.id,
          result: { roots: [{ uri: pathToFileURL(root).href, name: 'DSH workspace' }] },
        }))
      } else if ('id' in message) {
        pending.get(message.id)?.(message.error ? new Error(message.error.message) : null, message.result === undefined ? undefined : JSON.parse(JSON.stringify(message.result)))
      }
    },
    async close() {
      for (const settle of pending.values()) settle(new Error('Sequence workbench disconnected.'))
      transport.onclose?.()
    },
  }
  await server.connect(transport)

  function request(method, params, signal, timeout = 180_000) {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const id = ++nextId
      function settle(error, result) {
        pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        if (error) reject(error)
        else resolve(result)
      }
      function cancel() {
        if (!pending.has(id)) return
        const reason = signal?.aborted ? 'Request cancelled.' : 'Sequence workbench request timed out.'
        transport.onmessage({
          jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason },
        })
        settle(new Error(reason))
      }
      const timer = setTimeout(cancel, timeout)
      timer.unref()
      pending.set(id, settle)
      signal?.addEventListener('abort', cancel, { once: true })
      transport.onmessage({ jsonrpc: '2.0', id, method, params })
    })
  }

  try {
    await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: root ? { roots: { listChanged: false } } : {},
      clientInfo: { name: manifest.name, version: manifest.version },
    }, undefined, 10_000)
    transport.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const { tools } = await request('tools/list', {}, undefined, 10_000)
    return {
      request,
      tools: new Map(tools.map(tool => [tool.name, tool])),
      call: (name, args, signal) => request('tools/call', { name, arguments: args }, signal),
      flushCheckpoint: sessionId => server.flushDshCheckpoint(sessionId),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}
