/**
 * The file browser's edit-mode controls, composed by `FilesTab` into its wide
 * bar, compact bar and reader bar: the edit entry, save / cancel with the
 * unsaved marker, the editor's wrap toggle, and the Markdown edit / preview
 * switch with the rendered draft it shows.
 */
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitKey } from './locales.js'
import type { FileEditApi } from './use-file-edit.js'
import { EditIcon, WrapIcon } from './icons.js'
import { splitMermaidSegments, markdownKbdToCode, type MermaidSegment } from './mermaid-blocks.js'

type T = (key: GitKey, params?: Record<string, string | number>) => string

/** Markdown in edit mode offers its draft rendered: `text` holds what the
 * editor had when the user switched over (the editor stays mounted). */
export function useEditPreview(editing: boolean): {
  readonly text: string | null
  readonly set: (text: string | null) => void
  readonly segments: MermaidSegment[] | undefined
} {
  const [text, set] = useState<string | null>(null)
  useEffect(() => { if (!editing) set(null) }, [editing])
  const segments = useMemo<MermaidSegment[] | undefined>(() => (text === null
    ? undefined
    : splitMermaidSegments(text).map((segment) => segment.kind === 'mermaid'
      ? segment
      : { kind: 'markdown' as const, text: markdownKbdToCode(segment.text) })), [text])
  return { text, set, segments }
}

export interface EditControls {
  /** The entry into edit mode; null while editing or for a file without it. */
  readonly editButton: JSX.Element | null
  /** Unsaved marker, cancel and save; null outside edit mode. */
  readonly editActions: JSX.Element | null
  /** Word wrap for the editor (the read-only view's size cap does not apply:
   * the editor renders by viewport); null outside edit mode and in the
   * Markdown draft preview. */
  readonly editWrapButton: JSX.Element | null
  /** Edit / preview switch for a Markdown draft; null otherwise. */
  readonly editModeSeg: JSX.Element | null
}

export function renderEditControls(o: {
  readonly fileEdit: FileEditApi
  readonly editing: boolean
  readonly markdown: boolean
  readonly preview: { readonly text: string | null; readonly set: (text: string | null) => void }
  readonly wrap: boolean
  readonly toggleWrap: () => void
  readonly tipProps: (content: string) => Record<string, unknown>
  readonly hideTip: () => void
  /** Id prefix of the preview's SegmentedControl tab panels. */
  readonly modeId: string
  readonly t: T
}): EditControls {
  const { fileEdit, editing, preview, t } = o
  const avail = fileEdit.availability
  // Shown for allow-listed files, disabled with the reason in its tip when
  // the host says this one cannot be edited without loss.
  const editButton = editing || avail.state === 'hidden'
    ? null
    : h('button', {
      key: 'edit', type: 'button', className: 'gp-files__props gp-files__edit',
      'aria-label': t('files.edit'),
      ...(avail.state === 'disabled' ? { 'aria-disabled': true as const } : {}),
      'aria-busy': fileEdit.starting,
      ...o.tipProps(avail.state === 'disabled' ? t(avail.reason) : fileEdit.starting ? t('files.editStarting') : t('files.edit')),
      onClick: () => { if (avail.state === 'ready' && !fileEdit.starting) { o.hideTip(); fileEdit.start() } },
    }, h(EditIcon, { size: 14 }))
  // Save and cancel are labelled buttons: a disk write reads better as words
  // than as a glyph, and they are the only way out of edit mode.
  const editActions = editing
    ? h('div', { key: 'edit-actions', className: 'gp-files__edit-actions' }, [
      fileEdit.dirty ? h('span', { key: 'dirty', className: 'gp-files__edit-dirty' }, [
        h('span', { key: 'dot', className: 'gp-files__edit-dot', 'aria-hidden': 'true' }),
        t('files.editModified'),
      ]) : null,
      h('button', {
        key: 'cancel', type: 'button', className: 'gp-btn gp-files__edit-cancel', disabled: fileEdit.saving,
        onClick: () => { preview.set(null); fileEdit.cancel() },
      }, t('files.editCancel')),
      h('button', {
        key: 'save', type: 'button', className: 'gp-btn gp-btn--primary gp-files__edit-save',
        disabled: !fileEdit.dirty || fileEdit.saving, 'aria-busy': fileEdit.saving,
        onClick: () => fileEdit.save(),
      }, t(fileEdit.saving ? 'files.editSaving' : 'files.editSave')),
    ])
    : null
  const editWrapButton = editing && preview.text === null
    ? h('button', {
      key: 'wrap', type: 'button', className: 'gp-files__props',
      title: t('files.wrap'), 'aria-label': t('files.wrap'), 'aria-pressed': o.wrap,
      onClick: o.toggleWrap,
    }, h(WrapIcon, { size: 14 }))
    : null
  const editModeSeg = editing && o.markdown
    ? h(SegmentedControl, {
      key: 'mode',
      className: 'gp-files__mode-seg',
      id: o.modeId,
      label: t('files.editMode'),
      value: preview.text === null ? 'edit' : 'preview',
      options: [
        { value: 'edit', label: t('files.editModeEdit') },
        { value: 'preview', label: t('files.editModePreview') },
      ],
      onChange: (next: string) => preview.set(next === 'preview' ? fileEdit.currentText() : null),
    })
    : null
  return { editButton, editActions, editWrapButton, editModeSeg }
}
