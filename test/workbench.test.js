import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectEngine } from '../src/engine.js'
import { BINARY_EXTENSIONS, EXTENSIONS, FILE_PREFIX, FRAME_URI, sessionFile } from '../src/workbench-contract.js'

test('validates session-bound file addresses and keeps later suffixes intact', () => {
  assert.deepEqual(sessionFile('dsh-resource://file/session/example/sub/a%23b.fasta.gz'), {
    sessionId: 'example', path: 'sub/a#b.fasta.gz',
  })
  assert.equal(sessionFile('dsh-resource://file/absolute/sub/demo.fasta'), null)
  assert.equal(sessionFile('dsh-resource://file/session/example/%Q0'), null)
  for (const extension of ['fasta', 'fasta.gz', 'fastq.gz', 'gbff', 'dna', 'abi', 'scf', 'clw', 'stockholm', 'afa', 'aln-fasta']) {
    assert.ok(EXTENSIONS.includes(extension))
  }
  assert.ok(BINARY_EXTENSIONS.includes('gb.gz'))
  assert.ok(!BINARY_EXTENSIONS.includes('gb'))
})

test('bundled engine opens and restores an unchanged source under its own DSH root', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-seq-test-')))
  const root = join(directory, 'workspace')
  const state = join(directory, 'state')
  const path = join(root, 'demo.fasta')
  const outside = join(directory, 'outside.fasta')
  let engine
  try {
    await mkdir(root)
    await writeFile(path, '>fixture\nACGTACGT\n')
    await writeFile(outside, '>outside\nACCC\n')
    await symlink(outside, join(root, 'linked.fasta'))
    engine = await connectEngine(root, state)
    for (const name of [
      'sequence.get_context', 'sequence.align', 'sequence.run_analysis', 'sequence.edit_copy',
      'sequence.load_track', 'sequence.export_artifact', 'sequence.restore_session',
    ]) {
      assert.ok(engine.tools.get(name)?._meta.ui.visibility.includes('model'))
    }
    assert.equal((await engine.call('sequence.open_from_chat', { path: outside })).isError, true)
    assert.equal((await engine.call('sequence.open_from_chat', { path: 'linked.fasta' })).isError, true)
    const opened = await engine.call('sequence.open_from_chat', { path: 'demo.fasta' })
    const sessionId = opened.structuredContent.viewerSessionId
    const uri = opened._meta['openai/viewerFile'].primaryFile.uri
    assert.ok(uri.startsWith(FILE_PREFIX))
    assert.equal(opened.structuredContent.viewerReady, false)
    const flush = engine.flushCheckpoint(sessionId)
    const { structuredContent: { command } } = await engine.call('sequence.wait_for_viewer_command', {
      afterRevision: opened.structuredContent.viewerCommandRevision, sessionId, timeoutMs: 0,
    })
    assert.equal(command.action, 'dsh_flush_checkpoint')
    await engine.call('sequence.complete_viewer_command', {
      applied: true, commandId: command.commandId, message: 'Saved checkpoint.', sessionId, state: {},
    })
    assert.equal((await flush).applied, true)
    const html = await engine.request('resources/read', { uri: FRAME_URI })
    assert.match(html.contents[0].text, /DecompressionStream/)
    await engine.close()

    engine = await connectEngine(root, state)
    const restored = await engine.call('sequence.restore_chat_viewer_session', { sessionId, resourceUri: uri })
    assert.equal(restored.structuredContent.sessionId, sessionId)
    assert.equal(restored._meta['openai/scientific-viewer/plugin-source'].format, 'fasta')
    assert.equal(await readFile(path, 'utf8'), '>fixture\nACGTACGT\n')
    await writeFile(path, '>changed\nACGT\n')
    assert.equal((await engine.call('sequence.restore_chat_viewer_session', { sessionId, resourceUri: uri })).isError, true)
  } finally {
    await engine?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
