import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'

const source = new URL('../vendor/sequence-viewer/dist/', import.meta.url)
const output = new URL('../lib/sequence-viewer/', import.meta.url)

function replaceOnce(text, original, updated) {
  const index = text.indexOf(original)
  if (index === -1 || text.indexOf(original, index + original.length) !== -1) {
    throw new Error(`The pinned Sequence Viewer fragment did not match exactly once: ${original.slice(0, 100)}`)
  }
  return text.slice(0, index) + updated + text.slice(index + original.length)
}

function replaceBlock(text, from, until, edit) {
  const start = text.indexOf(from)
  const end = text.indexOf(until, start + from.length)
  if (start < 0 || end < 0) throw new Error(`Could not find upstream renderer block: ${from}`)
  return replaceOnce(text, text.slice(start, end), edit(text.slice(start, end)))
}

// Keep the virtual row height bounded. Lanes are packed per visible line, and
// dense tracks scroll independently so every feature remains reachable.
const featureTrack = [
  'const dshVisibleFeatureLanes = 4;',
  'function Dpe({ features, lineEnd, lineStart, selectedFeatureId, onSelectFeature }) {',
  '  const segments = features.flatMap(feature => oG(feature).flatMap(segment =>',
  '    segment.start <= lineEnd && segment.end >= lineStart',
  '      ? [{ feature, start: Math.max(lineStart, segment.start), end: Math.min(lineEnd, segment.end) }]',
  '      : []));',
  '  if (!segments.length) return null;',
  '  const lanes = r5(segments);',
  '  const laneCount = lanes.reduce((count, lane) => Math.max(count, lane.laneIndex + 1), 0);',
  '  const overflow = laneCount > dshVisibleFeatureLanes;',
  '  const buttons = lanes.map(({ end, feature, laneIndex, start }) => {',
  '    const label = Ope(feature);',
  '    return (0,Q.jsx)(`button`, {',
  '      "aria-label": oG(feature).length > 1',
  '        ? `Select ${feature.type} feature ${label} segment ${start}-${end}`',
  '        : `Select ${feature.type} feature ${label}`,',
  '      "aria-pressed": feature.id === selectedFeatureId,',
  '      className: `bio-sequence-feature absolute overflow-hidden rounded px-2`,',
  '      "data-feature-lane": laneIndex,',
  '      "data-feature-strand": feature.strand,',
  '      onClick: () => onSelectFeature(feature),',
  '      style: { clipPath: Mpe(feature.strand), height: `${e5 - 4}px`,',
  '        left: `${r8({coordinate:start,lineStart})}ch`, top: `${t5 + laneIndex * e5}px`,',
  '        width: `${i8({end,lineStart,start})}ch` },',
  '      title: `${label} · ${feature.start}–${feature.end} · ${feature.strand}`,',
  '      type: `button`,',
  '      children: (0,Q.jsx)(`span`, { className: `truncate text-[10px] font-medium`, children: label }),',
  '    }, `${feature.id}-${start}-${end}-${laneIndex}`);',
  '  });',
  '  return (0,Q.jsxs)(`div`, { className: `bio-sequence-track-row`, children: [',
  '    (0,Q.jsx)(`span`, { className: `bio-sequence-track-label`, children: `Features` }),',
  '    (0,Q.jsx)(`div`, { "aria-label": `Sequence feature tracks`,',
  '      role: overflow ? `region` : undefined, tabIndex: overflow ? 0 : undefined,',
  '      style: { height: `${n5(Math.min(laneCount, dshVisibleFeatureLanes))}px`, overflowY: overflow ? `auto` : undefined },',
  '      children: (0,Q.jsx)(`div`, { className: `relative`, style: { height: `${n5(laneCount)}px` }, children: buttons }),',
  '    }),',
  '    (0,Q.jsx)(`span`, {}),',
  '  ] });',
  '}', '',
].join('\n')

export function patchViewer(runtime) {
  // Inline is a presentation mode. It must not override the user's wrap mode.
  let patched = replaceBlock(runtime, 'function Fme(', 'function ', view => {
    view = replaceOnce(view, 'ye=he||h?_e:pe', 'ye=he?_e:pe')
    view = replaceOnce(view, 'automaticWrap:he||h,selectionChatAction:', 'automaticWrap:he,selectionChatAction:')
    view = replaceOnce(view, 'automaticWrap:he||h,onLineWidthChange:', 'automaticWrap:he,onLineWidthChange:')
    return replaceOnce(view, 'wrapWidth:t.wrapWidth??ye', 'automaticWrap:t.wrapWidth==null&&he,wrapWidth:t.wrapWidth??ye')
  })
  patched = replaceBlock(patched, 'function Dpe(', 'function Ope(', () => featureTrack)
  patched = replaceBlock(patched, 'function kpe(', 'function r5(', () => [
    'function kpe(features) {',
    '  const segments = features.flatMap(feature => oG(feature).map(segment => ({ ...segment, feature })));',
    '  return r5(segments).reduce((count, lane) => Math.max(count, lane.laneIndex + 1), 0);',
    '}',
  ].join('\n'))
  // Use the same local segments for both the virtual row height and the tracks.
  patched = replaceOnce(patched, 'j=p&&l.features.length>0?n5(kpe(l.features)):0',
    'j=(0,Y.useMemo)(()=>p?n5(Math.min(dshVisibleFeatureLanes,kpe(l.features))):0,[p,l.features])')
  // Render sequence, translation and quality above each line's annotation track.
  patched = replaceBlock(patched, 'function Rpe(', 'function zpe(', row => {
    const track = 'v?(0,Q.jsx)(Dpe,{features:p.features,lineEnd:n,lineStart:a,onSelectFeature:u,selectedFeatureId:h}):null'
    row = replaceOnce(row, `children:[${track},`, 'children:[')
    if (!row.endsWith(':null]})}')) throw new Error('The upstream residue row has a new structure.')
    return row.slice(0, -':null]})}'.length) + `:null,${track}]})}`
  })
  // Handle a private move command in the existing acknowledged viewer queue.
  patched = replaceOnce(patched, 'a=rne.safeParse(i);return a.success?',
    'a=rne.safeParse(i);if(i.action===`dsh_flush_checkpoint`)return {action:i.action,commandId:n,revision:r};return a.success?')
  patched = replaceOnce(patched, 'if(o.action===`set_display_mode`){let t=o.displayMode',
    'if(o.action===`dsh_flush_checkpoint`){let result;try{if(se==null)throw Error(`The viewer has no recoverable state.`);await se.flushForRelocation();result={applied:true,message:`Saved viewer state for relocation.`}}catch(e){result={applied:false,message:e instanceof Error?e.message:`Could not save viewer state for relocation.`}}c={command:o,result};continue}if(o.action===`set_display_mode`){let t=o.displayMode')
  patched = replaceOnce(patched, 'var FW=class{client;', 'var FW=class{client;#checkpointError;')
  patched = replaceOnce(patched, 'get restoredState(){return this.#e}async restore(',
    'get restoredState(){return this.#e}recordCheckpointError(error){this.#checkpointError=error}async flushForRelocation(){if(this.#checkpointError)throw this.#checkpointError;if(this.#e==null)throw Error(`The viewer has no recoverable state.`);try{await this.flush()}catch(error){this.#r=true;throw error}}async restore(')
  patched = replaceOnce(patched, 'kW(e),this.#e=e,this.#r=!0', 'kW(e),this.#checkpointError=void 0,this.#e=e,this.#r=!0')
  patched = replaceOnce(patched, 'catch(e){B(e instanceof Error?e.message:`The native Sequence state could not be checkpointed.`)',
    'catch(e){_.recordCheckpointError(e);B(e instanceof Error?e.message:`The native Sequence state could not be checkpointed.`)')
  patched = replaceOnce(patched, 'catch(e){P(e instanceof Error?e.message:`The native Alignment state could not be checkpointed.`)',
    'catch(e){_.recordCheckpointError(e);P(e instanceof Error?e.message:`The native Alignment state could not be checkpointed.`)')
  return patched
}

export async function buildViewerRuntime() {
  await mkdir(new URL('views/', output), { recursive: true })
  const [compressed, upstreamServer] = await Promise.all([
    readFile(new URL('views/app.js.gz', source)),
    readFile(new URL('server.mjs', source), 'utf8'),
  ])
  const patched = patchViewer(gunzipSync(compressed).toString('utf8'))
  const server = replaceOnce(upstreamServer, '  return server;\n}',
    '  return Object.assign(server, { flushDshCheckpoint: (sessionId) => commandStore.enqueue(sessionId, { action: "dsh_flush_checkpoint" }, 10000) });\n}')
  await Promise.all([
    writeFile(new URL('server.mjs', output), server),
    copyFile(new URL('views/styles.css', source), new URL('views/styles.css', output)),
    writeFile(new URL('views/app.js.gz', output), gzipSync(patched, { level: 9 })),
  ])
}
