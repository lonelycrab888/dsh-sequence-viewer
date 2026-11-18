# DSH Sequence Viewer

DSH Sequence Viewer 是 DeepSeek Harness（DSH）中的生物序列工作台。它支持 FASTA、GenBank、EMBL、FASTQ、多序列比对、Sanger ABIF/SCF 峰图，以及受支持的 SnapGene DNA 文件。可以从工作区文件树在右栏预览，也可以在对话中打开行内查看器。

你可以浏览和分析序列、比较比对结果、在可撤销的副本上编辑，并导出结果或保存会话供以后恢复。通过「询问选区」，智能体可以读取查看器里的当前选区、注释、比对结果或证据轨道，基于实时状态回答后续问题。

## 主要功能

| 功能 | 支持的数据与操作 |
| --- | --- |
| **序列浏览与注释** | 打开 FASTA、FASTQ、GenBank、EMBL，切换记录，按坐标、基序或注释定位，复制选区。支持线性图、环形图、分屏、反向互补显示，以及特征、质量和翻译轨道。 |
| **多序列比对** | 浏览 aligned FASTA、CLUSTAL、Stockholm、A2M/A3M、MSF、PHYLIP、NEXUS、PIR。可选择参考行、在参考坐标和比对列之间定位，并查看共识、差异、保守性、缺口比例和序列标识图（sequence logo）。 |
| **序列和比对分析** | 统计序列，按遗传密码表和阅读框翻译，查找开放阅读框（ORF），查看候选引物、限制性位点和酶切片段。也可生成两两或 center-star 比对、距离矩阵，并查看图形化的 NJ/UPGMA 引导树。 |
| **FASTQ 质量检查** | 查看读段数、长度范围、GC 和 Q30，也可生成基于有限读段的详细报告，查看逐周期质量和读段分布。 |
| **峰图与 SnapGene 文件** | 打开受支持版本的 ABIF（`.ab1`、`.abi`）和 SCF（`.scf`），查看文件记录的四色信号、峰位置、碱基判读和可用的置信度。受支持的 SnapGene（`.dna`）版本可显示序列、拓扑和注释。 |
| **外部证据轨道** | 在参考序列上叠加 GFF3/GTF/BED 注释、VCF 变异及 SAM/BAM/CRAM 读段。索引 BAM/CRAM 按指定参考区域加载，可查看读段堆叠和覆盖深度，并按比对质量、链方向或重复标记过滤。 |
| **副本编辑、导出和恢复** | 在可撤销的副本上编辑序列、比对或注释。可以导出 FASTA、GenBank、比对、轨道、CSV/TSV、Newick、SVG/PDF 等派生文件。有工作区写权限时，可另存文件及来源记录，或保存项目供以后恢复。工作区发布会创建新文件，保留原始输入。 |

受支持的 gzip/BGZF 文件可直接打开。符合条件的工作区 FASTA/FASTQ 可通过索引读取记录和区间。查看器会显示可用的来源元数据，并明确提示不支持的二进制版本或字段。格式版本、质控抽样和容量限制详见[能力与限制](vendor/sequence-viewer/CAPABILITY_MATRIX.md)。

## 安装

```sh
dsh plugin --profile web add dsh-sequence-viewer
dsh web
```

安装清单要求 DSH `>=0.2.2-rc.2`。运行需要宿主提供右栏预览、对话工具和本地工作区访问。安装或更新后重启 DSH Host，再刷新 Web 客户端。

## 开始使用

1. **打开工作区文件。** 在文件树点击文件可在右栏预览，也可以在对话中让智能体打开指定文件。对话打开的查看器可在行内和右栏之间移动，文件树打开的预览可切换到全屏。
2. **就当前选区提问。** 在查看器中选择序列范围、注释或比对单元格，点击「询问选区」。DSH 会把查看器 ID 和选区修订号填入对话草稿，发送后智能体可读取对应状态。
3. **添加读段证据。** 先打开匹配的参考序列，在 **Tracks → Add from workspace** 选择轨道。BAM 需要 BAI 或 CSI，CRAM 需要 CRAI，并通常需要匹配的 FASTA。核对索引和参考文件后，指定 contig 和区域再加载。
4. **保存结果或项目。** 用导出工具保存需要交付的结果，用 **Save project** 保存可继续操作的项目。重新打开原文件后，可在 **Review saved projects** 中选择项目并确认恢复。

大型峰图等会话超出 512 KiB 完整存档上限时，行内与右栏之间的移动可通过绑定原文件的查看状态恢复窗口和选区。原文件须保持可访问且内容一致。

## 对话工具

支持技能的 DSH profile 会发现 [dsh-sequence-viewer 技能](skills/sequence-viewer/SKILL.md)，其中说明了如何选择工具、定位查看器和核对结果。

| 工具 | 用途 |
| --- | --- |
| `sequence_open` | 按工作区内的 `path` 或固定的 `exampleId` 打开。用返回的 `viewerId` 调用 `sequence_workbench` 的 `wait`，检查 `viewerReady`。 |
| `sequence_read_selection` | 读取当前选区。若请求来自「询问选区」，带上引用中的 `expectedRevision`。 |
| `sequence_find_features` | 按名称、类型或 ID 查找注释，可用 `nextCursor` 分页。 |
| `sequence_set_display` | 修改序列行宽、特征轨道、配色或地图设置，回执包含实际应用的设置。 |
| `sequence_export` | 按指定格式和范围导出。需要工作区文件时传 `workspacePath`，路径相对于源文件的目录。 |

`sequence_workbench` 继续接收 `action` 和相应参数。

| Action | 用途 |
| --- | --- |
| `open` | 按 `path` 打开工作区文件，或按 `exampleId` 获取固定的公共样例。支持 `placement: "inline"` 或 `"sidebar"`。 |
| `viewers` / `status` / `wait` | 查找当前会话的查看器并确认渲染状态。 |
| `context` | 使用 `viewerId` 及可选的 `arguments.sections` 或 `expectedRevision` 读取实时状态。 |
| `operations` / `help` | 列出可用的上游操作，按 `operation` 查看输入结构。 |
| `run` | 用 `operation` 和 `arguments` 执行查询、控制、分析、编辑、导出、保存或恢复。插件绑定引擎会话 ID。 |
| `move` | 移动对话中已经打开的查看器。 |
| `examples` | 列出 ENA、UniProtKB、NCBI 和 Rfam 的固定样例及后续工作流。 |

### 显示设置与工具参数

- `set_sequence_view_options` 只更新传入的字段。仅切换 `showFeatures` 时，行宽、配色和其他显示设置会保留。
- `wrapWidth` 接受 `40`、`50`、`60`、`80`，指定后按固定宽度换行，可横向滚动。显示面板的 Auto 按当前可用宽度计算，所以可以显示 10、20 或 30 个字符一行。密集的 Features 轨道可以单独滚动，碱基和翻译位于特征条上方。
- 优先使用 `open` 或 `context` 返回的 `viewerId`。同一会话内也可使用 `context` 返回的引擎 `sessionId`。
- 当前会话有多个查看器时，请指定 `viewerId`。省略 ID 会返回 `ambiguous_viewer` 和候选列表，可按工作区相对路径或示例 ID 区分。
- `translate` 使用带正负号的 `frame` 指定阅读框。比如负链第一阅读框传 `frame: -1`。`strands` 用于 `find-orfs`。
- `search_document` 必须提供 `documentId`。先调用 `sequence.list_documents`，使用它返回的确切 ID。

收到 `jobId` 后，查询任务状态并在当前查看器核对结果。工作区输出的可写范围由 DSH 当前会话权限决定。

## 示例提示词

复制任意一条到 DSH 对话中发送。运行时会从官方端点获取并验证固定版本的公共样例。

### ENA FASTQ 质量检查

> 请用 `sequence_workbench` 的 `open` 操作打开 `ena-drr037765-first-500`。从查看器读取 FASTQ 的读段数量、长度范围、GC 比例和 Q30，并说明这 500 条读段来自哪个数据集、如何选取。

### UniProtKB 人类 RAS 蛋白比对

> 请用 `sequence_workbench` 的 `open` 操作打开 `uniprot-human-ras-sv1`。将 P01116 设为参考行，比较保守区域和蛋白末端的差异，并生成距离矩阵和探索性的邻接引导树。

### NCBI GenBank 注释浏览

> 请用 `sequence_workbench` 的 `open` 操作打开 `ncbi-nc-001416-1`，以行内卡片显示。开启 Features 并定位到 cI 注释，从查看器报告该特征的类型、坐标和链方向。

### Rfam Stockholm 多序列比对

> 请用 `sequence_workbench` 的 `open` 操作打开 `rfam-rf00360-15-1`。查看 Stockholm 种子比对，比较各行的保守区域，并指出差异较大的列。

## 构建与许可

```sh
npm ci
npm test
mkdir -p dist
npm pack --pack-destination dist
```

本插件是对 OpenAI **Biological Sequence & Alignment Viewer 0.1.53** 的 DSH 复刻，使用其发布的查看器运行时，并针对 DSH 适配了文件预览、对话工具和查看器状态恢复。随包分发[运行时来源](vendor/sequence-viewer/SOURCE.md)。

上游运行时采用 MIT 许可，随包附有依赖项的许可证与版权声明。[MIT 许可全文](vendor/sequence-viewer/LICENSE) · [第三方许可说明](vendor/sequence-viewer/THIRD_PARTY_NOTICES.md)
