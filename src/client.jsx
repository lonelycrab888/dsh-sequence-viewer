import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BINARY_EXTENSIONS, EXTENSIONS, FRAME_ADDRESS, isViewerId, PLUGIN_ID, READ_SELECTION_TOOL, ROUTE } from './workbench-contract.js'
import { version } from '../package.json'
import css from './workbench.css'

const zh = navigator.language.toLowerCase().startsWith('zh')
const label = zh ? {
  title: '生物序列与比对工作台', loading: '正在打开工作台…', retry: '重试',
  open: '在对话中打开', right: '转到右栏', back: '返回对话', close: '退出全屏',
  ask: '询问选区', expand: '全屏预览', copied: '已将选区引用填入对话草稿。',
} : {
  title: 'Biological Sequence & Alignment Workbench', loading: 'Opening workbench…', retry: 'Retry',
  open: 'Open in chat', right: 'Move to sidebar', back: 'Return to chat', close: 'Exit fullscreen',
  ask: 'Ask about selection', expand: 'Full-screen preview', copied: 'Added the selection reference to the conversation draft.',
}

async function request(owner, action, params, signal) {
  const response = await fetch(`${ROUTE}/api`, {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner, action, ...params }),
  })
  const value = await response.json()
  if (!response.ok || value.error) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}

const placements = new Map()
const subscribers = new Set()
function subscribe(listener) {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}
function place(owner, id, placement) {
  placements.set(`${owner}:${id}`, placement)
  for (const listener of subscribers) listener()
}

function useSetup(owner, action, identity, revision) {
  const [ready, setReady] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    const params = action === 'preview' ? { address: identity } : { viewerId: identity }
    void request(owner, action, params, controller.signal).then(
      value => { if (!controller.signal.aborted) setReady({ identity, revision, value }) },
      error => { if (!controller.signal.aborted) setReady({ identity, revision, error }) },
    )
    return () => controller.abort()
  }, [owner, action, identity, revision])
  return ready?.identity === identity && ready.revision === revision ? ready : null
}

const workbenchScene = {
  kind: PLUGIN_ID,
  target: 'chat',
  match: {
    'tool/result': event => event.surfaceOp === 'append' && event.data.message?.isError !== true ? sceneMatch(event) : null,
    'tool/ptc-dispatch': event => !event.data.isError ? sceneMatch(event) : null,
  },
  start: (_context, match) => match.event.data.meta.scene,
  update: (context, match) => match.event.data.meta.scene ?? context.state,
  publication: () => 'immediate',
  buildViewNode: context => {
    const match = context.start
    if (!match) return null
    const current = context.current.get('chat')
    if (current?.location === match.location && current.data === context.state) return current
    return {
      key: context.key, kind: PLUGIN_ID, id: context.id, target: 'chat',
      anchorSeq: match.event.seq, location: match.location, visibility: 'visible',
      groupTree: 'turn', data: context.state,
    }
  },
}
function sceneMatch(event) {
  const { meta } = event.data
  return meta?.plugin === PLUGIN_ID && isViewerId(meta.scene?.id) ? { id: meta.scene.id, role: 'start' } : null
}

function WorkbenchFrame({ owner, setup, layout, inputActions, move }) {
  const frame = useRef(null)
  const shell = useRef(null)
  const state = useRef({ inputActions, move })
  state.current = { inputActions, move }
  const [notice, setNotice] = useState('')
  const [overlay, setOverlay] = useState(false)
  const [asking, setAsking] = useState(false)
  const { id, title } = setup.scene

  useLayoutEffect(() => {
    const controller = new AbortController()
    const element = frame.current
    const container = shell.current
    let mode = layout === 'sidebar' ? 'fullscreen' : 'inline'
    const send = message => element.contentWindow?.postMessage({ jsonrpc: '2.0', ...message }, '*')
    const modes = layout === 'sidebar' && !state.current.move ? ['fullscreen'] : ['inline', 'fullscreen']
    let resuming = false

    function setMode(next) {
      if (!modes.includes(next)) throw new Error('Unsupported display mode.')
      if (mode === next) return
      if (state.current.move) {
        const placement = next === 'fullscreen' ? 'sidebar' : 'inline'
        // Allow the viewer to accept the host reply and save its checkpoint first.
        const previous = mode
        setTimeout(() => {
          if (controller.signal.aborted) return
          void state.current.move?.(placement).catch(error => {
            mode = previous
            send({ method: 'ui/notifications/host-context-changed', params: { displayMode: mode } })
            setNotice(error.message)
          })
        }, 120)
      }
      mode = next
    }

    async function onMessage(event) {
      if (event.source !== element.contentWindow || event.origin !== 'null' || event.data?.jsonrpc !== '2.0') return
      const { id: requestId, method, params } = event.data
      if (method === 'ui/notifications/initialized') {
        send({ method: 'ui/notifications/tool-result', params: setup.result })
        return
      }
      if (requestId === undefined) return
      try {
        let result
        switch (method) {
          case 'ui/initialize':
            result = {
              protocolVersion: params.protocolVersion,
              hostInfo: { name: 'DeepSeek Harness', version },
              hostCapabilities: { serverTools: {}, serverResources: {}, message: { text: {} } },
              hostContext: {
                displayMode: mode, availableDisplayModes: modes, locale: navigator.language,
                theme: getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 'dark' : 'light',
                platform: 'web',
              },
            }
            break
          case 'ui/request-display-mode':
            setMode(params.mode)
            result = { mode }
            break
          case 'ui/message': {
            const text = params.content?.filter(part => part.type === 'text').map(part => part.text).join('\n')
            if (!text || text.length > 8192) throw new Error('The selection reference is unavailable.')
            const hint = `Use ${READ_SELECTION_TOOL} with DSH viewerId ${id} and the expectedRevision above when provided.`
            if (!state.current.inputActions?.insertQuote(`${text}\n\n${hint}`)) throw new Error('The DSH conversation draft could not accept the reference.')
            setNotice(label.copied)
            result = {}
            break
          }
          case 'tools/call':
          case 'resources/read':
            result = (await request(owner, 'rpc', { viewerId: id, method, params }, controller.signal)).result
            if (!resuming && params.name === 'sequence.update_viewer_lifecycle' && params.arguments?.status === 'loading' && !result.isError) {
              resuming = true
              void request(owner, 'resume', { viewerId: id }, controller.signal).catch(error => {
                if (!controller.signal.aborted) setNotice(error.message)
              })
            }
            break
          default:
            throw new Error(`Unsupported viewer host request ${method}.`)
        }
        if (!controller.signal.aborted) send({ id: requestId, result })
      } catch (error) {
        if (!controller.signal.aborted) send({ id: requestId, error: { code: -32603, message: error.message } })
      }
    }

    window.addEventListener('message', onMessage, { signal: controller.signal })
    element.src = `${ROUTE}/frame/${encodeURIComponent(owner)}/${id}`
    return () => {
      send({ method: 'ui/resource-teardown', params: {} })
      if (container.hasAttribute('popover')) container.hidePopover()
      controller.abort()
    }
  }, [owner, setup, id, layout])

  async function ask() {
    setAsking(true)
    try {
      const selection = await request(owner, 'selection', { viewerId: id })
      const argumentsForModel = { viewerId: id,
        ...(selection.contextRevision ? { expectedRevision: selection.contextRevision } : {}) }
      const text = zh ? `请查看 ${JSON.stringify(selection.title)} 中的当前选区。` : `Please inspect my selection in ${JSON.stringify(selection.title)}.`
      if (!inputActions?.insertQuote(`${text}\n${READ_SELECTION_TOOL} ${JSON.stringify(argumentsForModel)}`)) throw new Error('The DSH conversation draft could not accept the reference.')
      setNotice(label.copied)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setAsking(false)
    }
  }

  function toggleOverlay() {
    const node = shell.current
    if (overlay) {
      node.hidePopover()
      node.removeAttribute('popover')
    } else {
      node.setAttribute('popover', 'manual')
      node.showPopover()
    }
    setOverlay(!overlay)
  }

  return <div ref={shell} className={`sw-frame sw-${layout}${overlay ? ' sw-fullscreen' : ''}`}>
    <div className="sw-toolbar">
      <span className="sw-title" title={title}>{title}</span>
      {!overlay && move && <button type="button" onClick={() => {
        void move(layout === 'sidebar' ? 'inline' : 'sidebar').catch(error => setNotice(error.message))
      }}>{layout === 'sidebar' ? label.back : label.right}</button>}
      {!move && <button type="button" onClick={toggleOverlay}>{overlay ? label.close : label.expand}</button>}
      <button type="button" onClick={ask} disabled={asking}>{label.ask}</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    <iframe ref={frame} title={label.title} sandbox="allow-scripts" allow="clipboard-write *" referrerPolicy="no-referrer" />
  </div>
}

function Pending({ error, retry }) {
  return <div className="sw-status" role={error ? 'alert' : 'status'}>
    {error?.message ?? label.loading}
    {error && <button type="button" onClick={retry}>{label.retry}</button>}
  </div>
}

function LoadedFrame({ owner, viewerId, layout, inputActions, move }) {
  const [revision, setRevision] = useState(0)
  const setup = useSetup(owner, 'setup', viewerId, revision)
  return setup?.value ? <WorkbenchFrame owner={owner} layout={layout} inputActions={inputActions} setup={setup.value} move={move} />
    : <Pending error={setup?.error} retry={() => setRevision(revision + 1)} />
}

function Preview({ sessionId, resourceAddress, content, inputActions }) {
  const setup = useSetup(sessionId, 'preview', resourceAddress, content.revision)
  useEffect(() => {
    if (setup?.value) content.loaded(setup.value.version)
    else if (setup?.error) content.failed()
  }, [setup, content.loaded, content.failed])
  return setup?.value ? <WorkbenchFrame owner={sessionId} layout="sidebar" inputActions={inputActions} setup={setup.value} />
    : <Pending error={setup?.error} retry={content.reload} />
}

function NativePreview(props) {
  return props.content.kind === 'renderer' ? <Preview {...props} /> : null
}

function ChatCard({ sessionId, node, inputActions, navigation }) {
  const [error, setError] = useState(null)
  const { id, title, placement, placementRevision } = node.data
  const priorPlacementRevision = useRef(placementRevision)
  useEffect(() => {
    if (placementRevision !== priorPlacementRevision.current) {
      priorPlacementRevision.current = placementRevision
      place(sessionId, id, placement)
      if (placement === 'inline') navigation.close(id)
    }
  }, [id, navigation, placement, placementRevision, sessionId])
  const [revision, setRevision] = useState(0)
  const setup = useSetup(sessionId, 'setup', id, revision)
  const storedPlacement = setup?.value?.scene.placement ?? placement
  const current = useSyncExternalStore(subscribe, () => placements.get(`${sessionId}:${id}`) ?? storedPlacement)
  useEffect(() => {
    if (setup?.value && current === 'sidebar') navigation.open(id)
  }, [current, id, navigation, setup])
  async function move(target) {
    await request(sessionId, 'placement', { viewerId: id, placement: target })
    if (target === 'sidebar') navigation.open(id)
    place(sessionId, id, target)
  }
  if (current === 'inline') return setup?.value
    ? <WorkbenchFrame owner={sessionId} layout="inline" inputActions={inputActions} setup={setup.value} move={move} />
    : <Pending error={setup?.error} retry={() => setRevision(revision + 1)} />
  return <div className="sw-status">
    <span>{title}</span>
    <button type="button" onClick={() => void move('inline').then(() => navigation.close(id), setError)}>{label.open}</button>
    {error && <span role="alert">{error.message}</span>}
  </div>
}

function Sidebar({ sessionId, useTabInfo, inputActions, navigation }) {
  const { tab } = useTabInfo()
  const id = tab.contentId.startsWith(FRAME_ADDRESS) ? tab.contentId.slice(FRAME_ADDRESS.length) : null
  if (!isViewerId(id) || !tab.visible) return null
  async function move(target) {
    await request(sessionId, 'placement', { viewerId: id, placement: target })
    place(sessionId, id, target)
    navigation.close(id)
  }
  return <LoadedFrame owner={sessionId} viewerId={id} layout="sidebar" inputActions={inputActions} move={move} />
}

export const inject = ['slots', 'documentPreviews', 'sidebarRight', 'sidebarRightTabs', 'uiConversation']

export function apply(ctx) {
  function navigation(sessionId) {
    return {
      open: id => ctx.sidebarRight.openResourceIn(sessionId, FRAME_ADDRESS + id),
      close: id => {
        const tab = ctx.sidebarRight.openTabs.getSnapshot().find(item => item.sessionId === sessionId && item.contentId === FRAME_ADDRESS + id)
        if (tab) ctx.sidebarRight.closeIn(sessionId, tab.tabId)
      },
    }
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPlugin = PLUGIN_ID
    style.textContent = css
    document.head.append(style)
    return () => { style.remove(); placements.clear(); subscribers.clear() }
  })
  ctx.effect(() => ctx.documentPreviews.register({
    id: PLUGIN_ID, extensions: EXTENSIONS, binaryExtensions: BINARY_EXTENSIONS,
    title: () => label.title, loading: 'renderer',
  }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: PLUGIN_ID,
  }, NativePreview)))
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID, kind: PLUGIN_ID, patterns: [`${FRAME_ADDRESS}*`],
    canOpen: address => address.startsWith(FRAME_ADDRESS) && isViewerId(address.slice(FRAME_ADDRESS.length)),
    title: () => label.title,
  }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PLUGIN_ID, inject: owner => ({ navigation: navigation(owner) }),
  }, Sidebar)))
  ctx.effect(() => ctx.uiConversation.events.register(workbenchScene))
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: PLUGIN_ID, inject: owner => ({ navigation: navigation(owner) }),
  }, ChatCard)))
}
