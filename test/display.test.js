import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { gunzipSync } from 'node:zlib'

test('a line with 285 overlapping annotations keeps residues first and scrolls its feature track', () => {
  const path = new URL('../lib/sequence-viewer/views/app.js.gz', import.meta.url)
  const bundle = gunzipSync(readFileSync(path)).toString('utf8')
  const start = bundle.indexOf('var e5=22,t5=4;')
  const end = bundle.indexOf('function zpe(', start)
  assert.ok(start >= 0 && end > start, 'find the installed sequence row renderer')

  const element = (type, props) => ({ type, props })
  const runtime = runInNewContext(bundle.slice(start, end) + '\n({ Dpe, Rpe, kpe })', {
    Q: { jsx: element, jsxs: element },
    oG: feature => feature.segments ?? [{ start: feature.start, end: feature.end }],
    r8: () => 0,
    i8: () => 60,
    n8: value => [value],
    dY: () => ({}),
    e8: 1,
  })
  const features = Array.from({ length: 285 }, (_, index) => ({
    id: `feature-${index}`, start: 1, end: 60, type: 'misc_feature', strand: '+',
  }))
  const featureRow = runtime.Dpe({ features, lineStart: 1, lineEnd: 60 })
  const featureViewport = featureRow.props.children[1].props
  assert.equal(featureViewport.style.height, '96px')
  assert.equal(featureViewport.style.overflowY, 'auto')
  assert.equal(featureViewport.tabIndex, 0)
  assert.equal(featureViewport.children.props.children.length, features.length)
  assert.equal(runtime.kpe([{ ...features[0], segments: [{ start: 1, end: 40 }, { start: 20, end: 60 }] }]), 2)

  const sequenceRow = runtime.Rpe({
    record: { id: 'fixture', sourceLabel: 'Fixture', molecule: 'dna', features },
    lineSequence: 'A', lineStart: 1, lineEnd: 1, lineWidth: 60, lineHeight: 200,
    activeCoordinate: 1, searchHitRanges: [], showFeatures: true,
  })
  assert.equal(sequenceRow.props.children[0].props.role, 'row')
  assert.equal(sequenceRow.props.children.at(-1).type, runtime.Dpe)
})
