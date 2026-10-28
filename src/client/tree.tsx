/**
 * MemoryTree — a pure-SVG tree visualization of the L3 memory graph.
 *
 * DSH client plugins must NOT load third-party front-end libraries (d3,
 * react-flow, echarts, etc.): requiring any harness client package or external
 * bundle blanks the slot entry. So this renders a tree with hand-built SVG
 * (no dependencies), driven by the same /state payload the panel already uses.
 *
 * Layout: a horizontal tree, root on the left. Four levels:
 *   L0 记忆树 (root)
 *   L1 规矩 / 事实 (type)
 *   L2 scope groups (empty scope → 全局)
 *   L3 memory nodes (leaves, one per active L3 node)
 *
 * Interactive: hover a leaf shows its full statement in a floating tooltip;
 * click a leaf focuses that node's card id (the panel scrolls to it).
 */

declare const React: any

const C = {
  text1: 'var(--dsw-alias-label-primary)',
  text2: 'var(--dsw-alias-label-secondary)',
  border1: 'var(--dsw-alias-border-l1)',
  brand: 'var(--dsw-alias-brand-primary)',
  idle: 'var(--dsw-alias-state-idle-primary)',
  err: 'var(--dsw-alias-state-error-primary)',
  bg: 'var(--dsw-alias-bg-layer-1)',
  bg2: 'var(--dsw-alias-bg-layer-2)',
}

type TreeNode = {
  id: string
  label: string
  kind: 'root' | 'type' | 'scope' | 'leaf'
  nodeId?: string // only for leaves: the L3 node id
  fullText?: string // only for leaves
  children: TreeNode[]
}

// --- geometry constants ----------------------------------------------------
const NODE_W = 132
const NODE_H = 32
const H_GAP = 28 // horizontal gap between levels
const V_GAP = 14 // vertical gap between siblings
const ROOT_X = 16
const ROOT_Y = 20

interface LayoutNode {
  node: TreeNode
  x: number
  y: number
}

function measureTree(root: TreeNode): { width: number; height: number; flat: LayoutNode[] } {
  const flat: LayoutNode[] = []

  // Compute subtree height (in px) for each node: a leaf is NODE_H tall; an
  // internal node is the sum of its children's heights plus gaps between them.
  function subHeight(n: TreeNode): number {
    if (n.children.length === 0) return NODE_H
    const sum = n.children.reduce((acc, c) => acc + subHeight(c), 0)
    return sum + V_GAP * (n.children.length - 1)
  }

  // Assign (x, y): x from depth, y by centering each node over its children.
  // `top` is the y of the first child; we return the y of the next free slot.
  function place(n: TreeNode, depth: number, top: number): number {
    const x = ROOT_X + depth * (NODE_W + H_GAP)
    let y: number
    if (n.children.length === 0) {
      y = top
      flat.push({ node: n, x, y })
      return top + NODE_H
    }
    let cursor = top
    const childYs: number[] = []
    for (const child of n.children) {
      const childTop = cursor
      cursor = place(child, depth + 1, childTop)
      // The child's own y was recorded inside place(); recompute it as the
      // midpoint of its subtree for centering.
      childYs.push(subtreeCenter(child))
    }
    const minY = Math.min(...childYs)
    const maxY = Math.max(...childYs)
    y = (minY + maxY) / 2
    flat.push({ node: n, x, y })
    return cursor
  }

  // Midpoint of a node's own vertical center within its subtree.
  function subtreeCenter(n: TreeNode): number {
    const rec = flat.find((f) => f.node === n)
    if (rec) return rec.y + NODE_H / 2
    return 0
  }

  place(root, 0, ROOT_Y)
  const totalHeight = subHeight(root) + ROOT_Y + 20
  const maxDepth = (function depth(n: TreeNode, d: number): number {
    return n.children.length === 0 ? d : Math.max(...n.children.map((c) => depth(c, d + 1)))
  })(root, 0)
  const width = ROOT_X + maxDepth * (NODE_W + H_GAP) + NODE_W + 16
  return { width, height: Math.max(totalHeight, NODE_H + 40), flat }
}

function buildTree(nodes: any[]): TreeNode {
  const root: TreeNode = { id: 'root', label: '记忆树', kind: 'root', children: [] }
  const typeGroups: Record<string, TreeNode> = {}
  const byType = new Map<string, any[]>()
  for (const n of nodes) {
    if (n.status !== 'active') continue
    const t = n.type === 'fact' ? 'fact' : 'rule'
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t)!.push(n)
  }
  for (const [type, list] of byType) {
    const typeNode: TreeNode = {
      id: 'type-' + type,
      label: type === 'rule' ? '规矩' : '事实',
      kind: 'type',
      children: [],
    }
    // group by scope
    const scopeGroups = new Map<string, any[]>()
    for (const n of list) {
      const scope = n.scope && n.scope.trim() ? n.scope.trim() : ''
      if (!scopeGroups.has(scope)) scopeGroups.set(scope, [])
      scopeGroups.get(scope)!.push(n)
    }
    for (const [scope, scopedNodes] of scopeGroups) {
      const scopeNode: TreeNode = {
        id: 'scope-' + type + '-' + (scope || 'global'),
        label: scope || '全局',
        kind: 'scope',
        children: [],
      }
      for (const n of scopedNodes) {
        scopeNode.children.push({
          id: 'leaf-' + n.id,
          label: truncate(n.statement, 12),
          kind: 'leaf',
          nodeId: n.id,
          fullText: n.statement,
          children: [],
        })
      }
      typeNode.children.push(scopeNode)
    }
    root.children.push(typeNode)
  }
  return root
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function fillFor(kind: TreeNode['kind']): string {
  switch (kind) {
    case 'root':
      // Root uses a dark surface with a brand border + brand text (below), never
      // a brand fill — brand-primary resolves to a LIGHT color in dark theme,
      // which would make the (light) label unreadable.
      return C.bg2
    case 'type':
      return C.idle
    case 'scope':
      return C.bg2
    case 'leaf':
      return C.bg
    default:
      return C.bg
  }
}

function strokeFor(kind: TreeNode['kind']): string {
  switch (kind) {
    case 'root':
      return C.brand
    case 'type':
      return C.border1
    case 'scope':
      return C.border1
    case 'leaf':
      return C.border1
    default:
      return C.border1
  }
}

function textColorFor(kind: TreeNode['kind']): string {
  switch (kind) {
    case 'root':
      // Brand may resolve dark in some themes; use the primary label color on
      // the dark root surface and distinguish the root via the brand BORDER
      // (strokeFor) and bold weight instead of brand text.
      return C.text1
    case 'type':
      return C.text1
    case 'scope':
      return C.text1
    case 'leaf':
      return C.text1
    default:
      return C.text1
  }
}

export function MemoryTree(props: { nodes: any[]; onFocus: (nodeId: string) => void }) {
  const [hover, setHover] = React.useState<{ x: number; y: number; text: string } | null>(null)

  const active = props.nodes.filter((n) => n.status === 'active')
  if (active.length === 0) {
    return React.createElement(
      'p',
      { style: { margin: 0, fontSize: 13, lineHeight: 1.7, color: C.text2 } },
      '还没有记住任何事，树是空的',
    )
  }

  const root = buildTree(props.nodes)
  const { width, height, flat } = measureTree(root)
  const byId = new Map(flat.map((f) => [f.node.id, f]))

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  function collectEdges(n: TreeNode) {
    const p = byId.get(n.id)
    if (!p) return
    for (const child of n.children) {
      const c = byId.get(child.id)
      if (c) {
        edges.push({
          x1: p.x + NODE_W,
          y1: p.y + NODE_H / 2,
          x2: c.x,
          y2: c.y + NODE_H / 2,
        })
      }
      collectEdges(child)
    }
  }
  collectEdges(root)

  return React.createElement(
    'div',
    {
      style: {
        position: 'relative',
        width: '100%',
        overflowX: 'scroll',
        overflowY: 'auto',
        borderRadius: 10,
        background: C.bg,
        border: `1px solid ${C.border1}`,
        maxHeight: 420,
        WebkitOverflowScrolling: 'touch',
      },
    },
    React.createElement(
      'svg',
      {
        width: width,
        height: height,
        style: { display: 'block', flex: 'none' },
        onMouseLeave: () => setHover(null),
      },
      // edges
      edges.map((e, i) =>
        React.createElement('path', {
          key: 'e' + i,
          d: `M ${e.x1} ${e.y1} C ${e.x1 + H_GAP / 2} ${e.y1}, ${e.x2 - H_GAP / 2} ${e.y2}, ${e.x2} ${e.y2}`,
          stroke: 'var(--dsw-alias-border-l1)',
          strokeWidth: 1,
          fill: 'none',
        }),
      ),
      // nodes
      flat.map((f) => {
        const isLeaf = f.node.kind === 'leaf'
        const fill = fillFor(f.node.kind)
        const textColor = textColorFor(f.node.kind)
        const rx = isLeaf ? 6 : 10
        return React.createElement(
          'g',
          {
            key: f.node.id,
            onMouseEnter: isLeaf
              ? (ev: any) => setHover({ x: ev.clientX, y: ev.clientY, text: f.node.fullText ?? '' })
              : undefined,
            onMouseMove: isLeaf ? (ev: any) => setHover({ x: ev.clientX, y: ev.clientY, text: f.node.fullText ?? '' }) : undefined,
            onClick: isLeaf ? () => props.onFocus(f.node.nodeId!) : undefined,
            style: isLeaf ? { cursor: 'pointer' } : undefined,
          },
          React.createElement('rect', {
            x: f.x,
            y: f.y,
            width: NODE_W,
            height: NODE_H,
            rx,
            fill,
            stroke: strokeFor(f.node.kind),
            strokeWidth: 1,
          }),
          React.createElement('text', {
            x: f.x + NODE_W / 2,
            y: f.y + NODE_H / 2,
            textAnchor: 'middle',
            dominantBaseline: 'central',
            fontSize: f.node.kind === 'leaf' ? 11 : 12,
            fontWeight: f.node.kind === 'root' ? 700 : f.node.kind === 'type' ? 600 : 400,
            fill: textColor,
          }, f.node.label),
        )
      }),
    ),
    // floating tooltip (positioned via fixed coordinates relative to viewport)
    hover
      ? React.createElement(
          'div',
          {
            style: {
              position: 'fixed',
              left: hover.x + 12,
              top: hover.y + 12,
              maxWidth: 280,
              padding: '8px 10px',
              fontSize: 12,
              lineHeight: 1.6,
              color: C.text1,
              background: C.bg,
              border: `1px solid ${C.border1}`,
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              zIndex: 9999,
              pointerEvents: 'none',
              whiteSpace: 'normal',
            },
          },
          hover.text,
        )
      : null,
  )
}
