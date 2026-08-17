import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * STEP-08-FROZEN-CONTRACT.md: "No custom marks/nodes beyond StarterKit's
 * defaults… the editor's own restricted toolbar is only UX, not a security
 * control" — the backend sanitizer's allowlist (`p, br, strong, em, u, s,
 * h2, h3, blockquote, ul, ol, li, code, pre, a[href]`) is the real
 * boundary. This toolbar only exposes commands StarterKit already ships
 * (Bold/Italic/Strike, H2/H3, blockquote, bullet/ordered list, code,
 * link), one button per allowlisted mark/node — nothing here can produce
 * markup outside that set.
 */
export function EssayToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    // A real link dialog is out of scope for STEP-08's "no images/tables
    // /comments" stub; a prompt is the smallest thing that lets a
    // reviewer add `a[href]` at all.
    const url = window.prompt('Link URL', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const buttons: { label: string; ariaLabel: string; isActive: boolean; onClick: () => void }[] = [
    {
      label: 'B',
      ariaLabel: 'Bold',
      isActive: editor.isActive('bold'),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'I',
      ariaLabel: 'Italic',
      isActive: editor.isActive('italic'),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'S',
      ariaLabel: 'Strikethrough',
      isActive: editor.isActive('strike'),
      onClick: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: 'H2',
      ariaLabel: 'Heading 2',
      isActive: editor.isActive('heading', { level: 2 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'H3',
      ariaLabel: 'Heading 3',
      isActive: editor.isActive('heading', { level: 3 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: '“ ”',
      ariaLabel: 'Blockquote',
      isActive: editor.isActive('blockquote'),
      onClick: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: '• list',
      ariaLabel: 'Bullet list',
      isActive: editor.isActive('bulletList'),
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: '1. list',
      ariaLabel: 'Ordered list',
      isActive: editor.isActive('orderedList'),
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: '</>',
      ariaLabel: 'Code',
      isActive: editor.isActive('code'),
      onClick: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: 'Link',
      ariaLabel: 'Link',
      isActive: editor.isActive('link'),
      onClick: setLink,
    },
  ]

  return (
    <div role="toolbar" aria-label="Essay formatting" className="flex flex-wrap gap-1">
      {buttons.map((b) => (
        <Button
          key={b.ariaLabel}
          type="button"
          size="sm"
          variant="outline"
          aria-label={b.ariaLabel}
          aria-pressed={b.isActive}
          className={cn(b.isActive && 'bg-muted text-foreground')}
          onClick={b.onClick}
        >
          {b.label}
        </Button>
      ))}
    </div>
  )
}
