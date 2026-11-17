import { EXAMPLE_IDS, READ_SELECTION_TOOL } from './workbench-contract.js'

const viewerId = {
  type: 'string',
  description: 'Viewer ID from opening, the selection reference, or sequence_workbench with action viewers. Supply it when several viewers are open.',
}
const string = { type: 'string', minLength: 1 }
const toggle = { type: 'boolean' }
const choice = (...values) => ({ type: 'string', enum: values })
const toRun = (operation, args, viewer) => ({ action: 'run', operation, viewerId: viewer, arguments: args })

export const focusedTools = [
  {
    name: 'sequence_open',
    description: 'Open a supported sequence or alignment file in the DSH viewer. Pass one workspace path or one pinned example ID. Wait for the returned viewer to finish rendering before inspecting or controlling it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { ...string, description: 'Exact path of a supported file in the current workspace.' },
        exampleId: choice(...EXAMPLE_IDS),
        placement: choice('inline', 'sidebar'),
      },
      oneOf: [{ required: ['path'] }, { required: ['exampleId'] }],
    },
    mapInput: args => ({ ...args, action: 'open' }),
  },
  {
    name: READ_SELECTION_TOOL,
    description: 'Explain or identify the current selection in a sequence or alignment viewer. Read the live selected range, feature, read, or alignment cell. Carry expectedRevision from an Ask about selection reference when provided.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { viewerId, expectedRevision: { ...string, description: 'Exact live revision from the selection reference or preceding context.' } },
    },
    mapInput: ({ viewerId, expectedRevision }) => ({
      action: 'context', viewerId, arguments: { sections: ['overview', 'selection'], scope: 'selection', expectedRevision },
    }),
  },
  {
    name: 'sequence_find_features',
    description: 'List or search biological annotation features in the mounted sequence. Returns exact feature IDs, locations and qualifiers. Use this to find a gene or annotation by name or type.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        viewerId,
        query: { ...string, maxLength: 500, description: 'Annotation text, type, or identifier to search.' },
        record: { ...string, maxLength: 500, description: 'Exact sequence record ID. Omit for the displayed record.' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        cursor: { ...string, maxLength: 8192, description: 'Copy nextCursor from the previous result with the same query and record.' },
      },
    },
    mapInput: ({ viewerId, ...args }) => toRun('sequence.query_viewer', { ...args, target: 'features' }, viewerId),
  },
  {
    name: 'sequence_set_display',
    description: 'Update at least one display setting in Sequence mode. Unspecified settings are preserved. Use this for fixed line width, features, quality, translation visibility, palette, orientation or map layout.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        viewerId,
        showFeatures: toggle,
        showQuality: toggle,
        showTranslation: toggle,
        wrapWidth: { type: 'integer', enum: [40, 50, 60, 80] },
        palette: choice('clustal-x', 'hydrophobicity', 'jalview-nucleotide', 'muted-amino-acid', 'muted-nucleic-acid', 'ncbi-nucleic-acid', 'neutral', 'nucleotide-ambiguity', 'purine-pyrimidine', 'rasmol', 'zappo'),
        layout: choice('circular', 'linear', 'split'),
        orientation: choice('forward', 'reverse-complement'),
        geneticCodeId: { type: 'integer', minimum: 1 },
        synchronizedViews: toggle,
        originRangeExpanded: toggle,
      },
    },
    mapInput: ({ viewerId, ...args }) => toRun('sequence.control_viewer', { ...args, action: 'set_sequence_view_options' }, viewerId),
  },
  {
    name: 'sequence_export',
    description: 'Export a derived copy from a mounted sequence or alignment viewer. Use workspacePath only when the user asks for a workspace file. Check the receipt for its published path.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['format'],
      properties: {
        viewerId,
        format: choice('a3m', 'aligned-fasta', 'bed', 'clustal', 'csv', 'embl', 'fasta', 'fastq', 'genbank', 'gff3', 'gtf', 'json', 'newick', 'pdf', 'stockholm', 'svg', 'tsv', 'vcf'),
        scope: choice('all', 'selection', 'visible'),
        workspacePath: { ...string, maxLength: 4096, description: 'Create this new path relative to the opened source directory. Omit for private storage.' },
      },
    },
    mapInput: ({ viewerId, format, scope, workspacePath }) => toRun('sequence.export_artifact', {
      format, scope,
      ...(workspacePath === undefined ? {} : { destination: { kind: 'workspace', base: 'opened-source', relativePath: workspacePath } }),
    }, viewerId),
  },
]
