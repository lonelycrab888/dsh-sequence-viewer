import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'

test('focused and legacy tools resolve the same viewers and return candidates for ambiguous edits', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-sequence-routing-')))
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'dsh')
  const tools = new Map()
  const agent = { id: 'routing-test', session: { header: { cwd: root } } }
  let skill
  let cleanup
  const ctx = {
    inject: (services, register) => {
      assert.deepEqual(services, ['skills'])
      register({ skills: { register: value => { skill = value } } })
    },
    tools: { register: tool => { tools.set(tool.name, tool) } },
    webServer: { register: () => () => {} },
    agents: new Map([[agent.id, agent]]),
    workspaceFiles: { stat: async () => ({ version: 'fixture' }) },
    effect: callback => { cleanup = callback() },
  }
  const call = (name, args) => tools.get(name).execute(args, { agent })
  try {
    await mkdir(join(root, 'other'))
    await writeFile(join(root, 'demo.fa'), '>first\nACGT\n')
    await writeFile(join(root, 'other', 'demo.fa'), '>second\nACGT\n')
    apply(ctx)
    assert.equal(skill.name, 'dsh-sequence-viewer')
    assert.match(skill.content, /sequence_read_selection/)
    assert.deepEqual(tools.get('sequence_set_display').parameters.properties.wrapWidth.enum, [40, 50, 60, 80])
    assert.deepEqual(tools.get('sequence_export').parameters.required, ['format'])

    const first = await call('sequence_open', { path: 'demo.fa' })
    assert.equal(first.ok, true, first.summary)
    const firstId = first.data.viewerId
    assert.deepEqual(first.data.nextAction, { tool: 'sequence_workbench', arguments: { action: 'wait', viewerId: firstId } })
    const unique = await call('sequence_workbench', { action: 'status' })
    assert.equal(unique.data.viewerId, firstId)

    const second = await call('sequence_workbench', { action: 'open', path: join('other', 'demo.fa') })
    assert.equal(second.ok, true, second.summary)
    const secondId = second.data.viewerId
    const ambiguous = await call('sequence_set_display', { wrapWidth: 60 })
    assert.equal(ambiguous.ok, false)
    assert.equal(ambiguous.data.code, 'ambiguous_viewer')
    assert.deepEqual(new Set(ambiguous.data.viewers.map(viewer => viewer.viewerId)), new Set([firstId, secondId]))
    assert.ok(ambiguous.data.viewers.every(viewer => viewer.title === 'demo.fa'))
    assert.deepEqual(new Set(ambiguous.data.viewers.map(viewer => viewer.path)), new Set(['demo.fa', join('other', 'demo.fa')]))
    const conflict = await call('sequence_workbench', { action: 'context', viewerId: firstId, sessionId: secondId })
    assert.match(conflict.summary, /different viewers/)
    const explicit = await call('sequence_workbench', { action: 'status', viewerId: firstId })
    assert.equal(explicit.data.viewerId, firstId)
  } finally {
    cleanup?.()
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    await rm(root, { recursive: true, force: true })
  }
})
