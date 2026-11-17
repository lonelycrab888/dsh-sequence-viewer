# DSH Sequence Viewer

Use the mounted viewer for the user's live selection, annotations, alignment, traces and evidence. Opening a file does not require reading its sequence into chat.

## Choose the target

- For a new file, use `sequence_open` with one exact workspace path or pinned example ID. The first response identifies the viewer. Call `sequence_workbench` with `action: "wait"` and that `viewerId` before using the new viewer. Check `viewerReady`.
- For an existing viewer, use the `viewerId` from its open result, selection reference, or `sequence_workbench` with `action: "viewers"`. Match the workspace-relative path or example ID when several titles look alike. If candidates remain ambiguous, ask which viewer to use.
- Preserve the active selection and display unless the user asks to change them. Use exact feature IDs and record IDs from the same viewer. Biological coordinates are 1-based and inclusive.

## Choose the operation

| User task | Tool |
| --- | --- |
| Identify or explain the current selection | `sequence_read_selection`. Carry the exact `expectedRevision` when supplied. Use `sections.selection.activeTarget` as the current object. If a selection reference is stale, ask the user to reselect. |
| Look up a gene or annotation | `sequence_find_features` with a name, type or exact ID. Use the same query and record when following `nextCursor`. |
| Change wrapping, Features, or other Sequence settings | `sequence_set_display`. Pass only the requested fields and check `data.applied` and the returned state. |
| Export the requested sequence, selection or alignment | `sequence_export` with the requested format and scope. Only pass `workspacePath` when the user requests a workspace file. Report the confirmed output path. |
| Read exact positions, alignment metrics or loaded evidence | `sequence_workbench` with `action: "run"`, `operation: "sequence.query_viewer"` and a matching `target`. Use `help` if the target's parameters are unclear. |
| Find text in a live viewer document | Use `sequence.list_documents` through `run`, then `sequence.search_document` with the returned `documentId` and query. |
| Change the selected object, switch viewer modes or control Alignment display | Use `sequence.control_viewer` through `run`. Discover exact IDs with a viewer query and read back the affected state. |
| Calculate results or align records | Use `sequence.run_analysis` or `sequence.align` through `run`. Use `help` for the operation's parameters. `data.jobId` is a receipt for the started job. Query `jobs` and verify the result in the same viewer before reporting completion. |

Use `operations` to discover additional workbench operations and `help` for their precise parameter schemas. Keep the same `viewerId` throughout a workflow. A failed response contains the reason to resolve before retrying.
