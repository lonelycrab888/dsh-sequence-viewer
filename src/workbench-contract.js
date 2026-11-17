export const PLUGIN_ID = 'dsh-sequence-viewer'
export const TOOL = 'sequence_workbench'
export const READ_SELECTION_TOOL = 'sequence_read_selection'
export const ROUTE = '/dsh-sequence-viewer/workbench'
export const FRAME_ADDRESS = 'dsh-resource://dsh-sequence-viewer/viewer/'
export const FRAME_URI = 'ui://sequence-viewer/viewer'
export const FILE_PREFIX = 'viewer-file://sequence-viewer/opened/'
export const ARTIFACT_PREFIX = 'viewer-artifact://sequence-viewer/generated/'
export const EXAMPLE_IDS = ['ena-drr037765-first-500', 'uniprot-human-ras-sv1', 'ncbi-nc-001416-1', 'rfam-rf00360-15-1']
export const isViewerId = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u.test(value)

const fasta = ['fa', 'faa', 'fas', 'fasta', 'ffn', 'fna', 'frn', 'mfa']
const aligned = ['a2m', 'a3m', 'afa', 'afasta', 'aln', 'aln-fasta', 'clustal', 'clw', 'msf', 'nex', 'nexus', 'phy', 'phylip', 'pir', 'stk', 'sto', 'stockholm']
const text = [...fasta, ...aligned, 'gb', 'gbk', 'genbank', 'gbff', 'embl', 'emb', 'fastq', 'fq']
export const BINARY_EXTENSIONS = ['ab1', 'abi', 'scf', 'dna', ...text.flatMap(ext => ['gz', 'bgz', 'bgzf'].map(suffix => `${ext}.${suffix}`))]
export const EXTENSIONS = [...text, ...BINARY_EXTENSIONS]

export function sessionFile(address) {
  const match = /^dsh-resource:\/\/file\/session\/([^/]+)\/([^?#]+)(?:[?#].*)?$/.exec(address)
  if (!match) return null
  try {
    return {
      sessionId: decodeURIComponent(match[1]),
      path: match[2].split('/').map(decodeURIComponent).join('/'),
    }
  } catch {
    return null
  }
}
