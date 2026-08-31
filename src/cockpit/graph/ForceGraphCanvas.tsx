import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import {
  DISTRUST_COLOR,
  NEUTRAL_COLOR,
  resolutionColor,
  ROOT_COLOR,
  TRUST_COLOR,
  type GraphViewSettings,
  type GraphVizData,
  type GraphVizLink,
  type GraphVizNode,
} from './types'
import { positionPathColumns } from './path-columns'

export interface ForceGraphCanvasProps {
  data: GraphVizData
  settings: GraphViewSettings
  selectedId?: string
  rootId?: string
  onNodeClick: (node: GraphVizNode, event: MouseEvent) => void
  /** When true, fix nodes into a left-to-right path layout. */
  pathLayout?: boolean
  /** Explicit chrome theme for node borders / labels. */
  darkTheme?: boolean
  /** Hidden Graph/Path layers still mount; refresh when this layer is shown. */
  active?: boolean
}

const NEUTRAL_FALLBACK = '#8b95a8'
const GENERIC_PERSON_COLOR = 'rgba(255, 255, 255, 0.92)'
const POST_ICON_COLOR = '#657786'
const AGGREGATE_FILL = '#536471'

function nodeSupportsIcon(node: GraphVizNode): boolean {
  return (
    node.kind === 'pubkey' ||
    node.kind === 'twitter_id' ||
    node.kind === 'post'
  )
}

function isPersonIconNode(node: GraphVizNode): boolean {
  return node.kind === 'pubkey' || node.kind === 'twitter_id'
}

/** Painted disc radius — keep in sync with `nodeVal` so arrows sit on the rim. */
function nodeVisualRadius(node: GraphVizNode): number {
  if (node.kind === 'aggregate') return 14
  if (node.isRoot) return 11
  if (nodeSupportsIcon(node)) return 9
  return 7
}

function linkStroke(link: GraphVizLink): string {
  if (link.eventId.startsWith('agg:')) return NEUTRAL_COLOR
  if (link.value === 1) return TRUST_COLOR
  if (link.value === 0) return NEUTRAL_COLOR
  return DISTRUST_COLOR
}

function drawLinkArrow(
  ctx: CanvasRenderingContext2D,
  link: GraphVizLink,
  globalScale: number,
): void {
  const source = typeof link.source === 'string' ? undefined : link.source
  const target = typeof link.target === 'string' ? undefined : link.target
  if (
    source?.x === undefined ||
    source.y === undefined ||
    target?.x === undefined ||
    target.y === undefined
  ) {
    return
  }
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return
  const ux = dx / length
  const uy = dy / length
  const startR = nodeVisualRadius(source)
  const endR = nodeVisualRadius(target)
  const sx = source.x + ux * startR
  const sy = source.y + uy * startR
  const ex = target.x - ux * endR
  const ey = target.y - uy * endR
  const stroke = linkStroke(link)
  const scale = Math.max(globalScale, 0.5)
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(ex, ey)
  ctx.strokeStyle = stroke
  ctx.lineWidth = (link.eventId.startsWith('agg:') ? 0.45 : 0.6) / scale
  ctx.stroke()
  const head = 7 / scale
  const left = Math.atan2(uy, ux) - 0.38
  const right = Math.atan2(uy, ux) + 0.38
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - head * Math.cos(left), ey - head * Math.sin(left))
  ctx.lineTo(ex - head * Math.cos(right), ey - head * Math.sin(right))
  ctx.closePath()
  ctx.fillStyle = stroke
  ctx.fill()
}

function bindLinkEndpoints(
  nodes: GraphVizNode[],
  links: GraphVizLink[],
): GraphVizLink[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return links.map((link) => {
    const sourceId =
      typeof link.source === 'string' ? link.source : link.source.id
    const targetId =
      typeof link.target === 'string' ? link.target : link.target.id
    return {
      ...link,
      source: nodeById.get(sourceId) ?? sourceId,
      target: nodeById.get(targetId) ?? targetId,
    }
  })
}

function iconBorderStyle(
  selected: boolean,
  dark: boolean,
): { stroke: string; lineWidth: number } {
  if (dark) {
    return selected
      ? { stroke: 'rgba(255, 255, 255, 0.92)', lineWidth: 2.25 }
      : { stroke: 'rgba(255, 255, 255, 0.38)', lineWidth: 1.15 }
  }
  return selected
    ? { stroke: 'rgba(15, 20, 25, 0.9)', lineWidth: 2.25 }
    : { stroke: 'rgba(15, 20, 25, 0.5)', lineWidth: 1.15 }
}

function labelColors(dark: boolean): { primary: string; secondary: string } {
  if (dark) {
    return {
      primary: 'rgba(240, 243, 246, 0.92)',
      secondary: 'rgba(139, 152, 165, 0.95)',
    }
  }
  return {
    primary: 'rgba(15, 20, 25, 0.88)',
    secondary: 'rgba(83, 100, 113, 0.95)',
  }
}

function topologyKey(data: GraphVizData): string {
  const nodeIds = data.nodes.map((node) => node.id).join('\0')
  const linkIds = data.links.map((link) => link.id).join('\0')
  return `${nodeIds}#${linkIds}`
}

function syncNodeProps(target: GraphVizNode, source: GraphVizNode): void {
  target.kind = source.kind
  target.depth = source.depth
  target.label = source.label
  target.expanded = source.expanded
  target.expandedFrom = source.expandedFrom
  target.resolution = source.resolution
  target.isRoot = source.isRoot
  target.isFocus = source.isFocus
  target.picture = source.picture
  target.subtitle = source.subtitle
  target.aggregateParentId = source.aggregateParentId
  target.aggregateRemaining = source.aggregateRemaining
  target.collapsedFromIds = source.collapsedFromIds
  if (source.unidentifiedKind) target.unidentifiedKind = source.unidentifiedKind
  else delete target.unidentifiedKind
}

function applyLayoutFixes(
  nodes: GraphVizNode[],
  pathLayout: boolean,
  layout: GraphViewSettings['layout'],
): void {
  if (pathLayout) {
    positionPathColumns(nodes)
    return
  }
  const byDepth = new Map<number, GraphVizNode[]>()
  const center =
    nodes.find((node) => node.isFocus) ?? nodes.find((node) => node.isRoot)
  for (const node of nodes) {
    // Clear previous fixes unless this layout re-applies them.
    if (layout !== 'radial' && !node.isFocus && !node.isRoot) {
      node.fx = undefined
      node.fy = undefined
    }
    const visualDepth =
      layout === 'radial' && center
        ? node.id === center.id
          ? 0
          : node.isRoot && center.id !== node.id
            ? 1
            : Math.max(1, node.depth - center.depth)
        : node.depth
    const list = byDepth.get(visualDepth) ?? []
    list.push(node)
    byDepth.set(visualDepth, list)
  }
  if (layout === 'radial') {
    for (const [depth, ring] of byDepth) {
      ring.forEach((node, index) => {
        const angle = (index / Math.max(1, ring.length)) * Math.PI * 2
        const radius = depth * 95
        node.fx = Math.cos(angle) * radius
        node.fy = Math.sin(angle) * radius
      })
    }
    return
  }
  if (center) {
    // Keep the requested focus stable while new neighborhoods settle.
    center.fx = 0
    center.fy = 0
  }
}

function drawGenericPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  const headRadius = radius * 0.3
  const headY = y - radius * 0.2
  ctx.save()
  ctx.fillStyle = GENERIC_PERSON_COLOR
  ctx.beginPath()
  ctx.arc(x, headY, headRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y + radius * 0.58, radius * 0.52, Math.PI, 0)
  ctx.fill()
  ctx.restore()
}

/** Text-line glyph for post nodes (matches content trust-card post icon). */
function drawPostIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  dark: boolean,
): void {
  const lineWidth = Math.max(1.2, radius * 0.18)
  const half = radius * 0.48
  const shortHalf = half * 0.68
  const gap = radius * 0.32
  ctx.save()
  ctx.strokeStyle = dark ? '#aab8c2' : POST_ICON_COLOR
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  for (const [dy, w] of [
    [-gap, half],
    [0, half],
    [gap, shortHalf],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(x - w, y + dy)
    ctx.lineTo(x + w, y + dy)
    ctx.stroke()
  }
  ctx.restore()
}

export default function ForceGraphCanvas({
  data,
  settings,
  selectedId,
  onNodeClick,
  pathLayout = false,
  darkTheme: darkThemeProp,
  active = true,
}: ForceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<{
    d3Force?: (forceName: string, force?: unknown) => unknown
    refresh?: () => void
  } | null>(null)
  const imageCache = useRef(new Map<string, HTMLImageElement>())
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const graphDataRef = useRef<GraphVizData>({ nodes: [], links: [] })
  const topologyKeyRef = useRef('')
  const layoutModeRef = useRef('')
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [imageRevision, setImageRevision] = useState(0)
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const darkTheme = darkThemeProp ?? systemDark

  useEffect(() => {
    if (darkThemeProp !== undefined) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [darkThemeProp])

  /**
   * Keep a stable `graphData` object when topology is unchanged.
   * Selection / enrichment rebuild `data` every time; a new graphData
   * reference reheats the force simulation and jolts the layout on click.
   */
  const graphData = useMemo(() => {
    const layoutMode = pathLayout ? 'path' : settings.layout
    const nextKey = topologyKey(data)
    const prev = graphDataRef.current
    const layoutChanged = layoutModeRef.current !== layoutMode
    layoutModeRef.current = layoutMode

    if (
      nextKey === topologyKeyRef.current &&
      !layoutChanged &&
      prev.nodes.length > 0
    ) {
      const incoming = new Map(data.nodes.map((node) => [node.id, node]))
      for (const node of prev.nodes) {
        const source = incoming.get(node.id)
        if (source) syncNodeProps(node, source)
      }
      // Path/radial need fx/fy refreshed; force layout must keep drag pins
      // and settled positions (re-running applyLayoutFixes clears them).
      if (pathLayout || settings.layout === 'radial') {
        applyLayoutFixes(prev.nodes, pathLayout, settings.layout)
      }
      return prev
    }

    topologyKeyRef.current = nextKey
    const nodes = data.nodes.map((node) => {
      const previous = !pathLayout ? positions.current.get(node.id) : undefined
      return {
        ...node,
        ...(previous ? { x: previous.x, y: previous.y } : {}),
      }
    })
    applyLayoutFixes(nodes, pathLayout, settings.layout)
    const next: GraphVizData = {
      nodes,
      links: bindLinkEndpoints(nodes, data.links),
    }
    graphDataRef.current = next
    return next
  }, [data, pathLayout, settings.layout])

  const pinForceNodes = () => {
    if (pathLayout || settings.layout === 'radial') return
    for (const node of graphDataRef.current.nodes) {
      if (node.x === undefined || node.y === undefined) continue
      // Keep the layout center anchored; pin others where they settled/dragged.
      if (node.isFocus || node.isRoot) {
        node.fx = 0
        node.fy = 0
      } else {
        node.fx = node.x
        node.fy = node.y
      }
      positions.current.set(node.id, { x: node.x, y: node.y })
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      setSize({
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!settings.showUserIcons) return
    for (const node of data.nodes) {
      if (!node.picture || imageCache.current.has(node.picture)) continue
      const image = new Image()
      image.decoding = 'async'
      image.referrerPolicy = 'no-referrer'
      image.onload = () => setImageRevision((value) => value + 1)
      image.onerror = () => imageCache.current.delete(node.picture!)
      imageCache.current.set(node.picture, image)
      image.src = node.picture
    }
  }, [data.nodes, settings.showUserIcons])

  useEffect(() => {
    if (pathLayout || settings.layout === 'radial') return
    const fg = fgRef.current
    if (!fg?.d3Force) return
    const charge = fg.d3Force('charge') as
      | { strength?: (s: number) => unknown; distanceMax?: (d: number) => unknown }
      | undefined
    const link = fg.d3Force('link') as
      | { distance?: (d: number) => unknown }
      | undefined
    charge?.strength?.(-180)
    charge?.distanceMax?.(420)
    link?.distance?.(72)
  }, [graphData.nodes.length, pathLayout, settings.layout])

  useEffect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      fgRef.current?.refresh?.()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, graphData])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph2D
        ref={fgRef as never}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeRelSize={1}
        nodeVal={(node) => {
          const r = nodeVisualRadius(node as GraphVizNode)
          return r * r
        }}
        linkSource="source"
        linkTarget="target"
        linkDirectionalArrowLength={0}
        linkWidth={0.6}
        linkColor={() => 'rgba(0,0,0,0)'}
        linkCanvasObjectMode={() => 'replace'}
        linkCanvasObject={(link, ctx, globalScale) => {
          drawLinkArrow(ctx, link as GraphVizLink, globalScale)
        }}
        cooldownTicks={
          pathLayout ? 0 : settings.layout === 'radial' ? 1 : 80
        }
        // Drag is fine once nodes are pinned after cooldown; a bare click
        // still reheats, but pinned fx/fy prevent the layout jolt.
        enableNodeDrag={!pathLayout && settings.layout !== 'radial'}
        onEngineStop={pinForceNodes}
        onNodeDragEnd={(node) => {
          const n = node as GraphVizNode
          if (n.x === undefined || n.y === undefined) return
          if (n.isFocus || n.isRoot) {
            n.fx = 0
            n.fy = 0
            n.x = 0
            n.y = 0
          } else {
            n.fx = n.x
            n.fy = n.y
          }
          positions.current.set(n.id, { x: n.x, y: n.y })
        }}
        onEngineTick={() => {
          for (const node of graphData.nodes) {
            if (node.x !== undefined && node.y !== undefined) {
              positions.current.set(node.id, { x: node.x, y: node.y })
            }
          }
        }}
        onNodeClick={(node, event) =>
          onNodeClick(node as GraphVizNode, event)
        }
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          void imageRevision
          void selectedId
          void darkTheme
          void settings.colorByTrust
          const n = node as GraphVizNode
          const x = n.x ?? 0
          const y = n.y ?? 0
          const iconNode = nodeSupportsIcon(n)
          const personNode = isPersonIconNode(n)
          const selected = selectedId === n.id
          const radius = nodeVisualRadius(n)
          const scale = Math.max(globalScale, 0.5)

          if (n.kind === 'aggregate') {
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fillStyle = AGGREGATE_FILL
            ctx.fill()
            const fontSize = 11 / globalScale
            ctx.font = `700 ${fontSize}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = '#fff'
            ctx.fillText(n.label, x, y)
            return
          }

          let fill = NEUTRAL_FALLBACK
          if (n.kind === 'post' && settings.showUserIcons) {
            // Neutral gray disc so the gray post glyph stays readable.
            fill = darkTheme ? '#38444d' : '#e7e9ea'
          } else if (pathLayout) {
            fill = n.isRoot ? ROOT_COLOR : resolutionColor(n.resolution)
          }
          // Slightly brighter fill for expanded hubs (no ring).
          if (n.expanded && !(n.kind === 'post' && settings.showUserIcons)) {
            fill = fill === NEUTRAL_FALLBACK ? '#a8b0c0' : fill
          }
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fillStyle = fill
          ctx.fill()

          const picture =
            settings.showUserIcons && personNode && n.picture
              ? imageCache.current.get(n.picture)
              : undefined
          const hasIcon =
            (picture?.complete && picture.naturalWidth > 0) ||
            (iconNode && settings.showUserIcons)

          if (picture?.complete && picture.naturalWidth > 0) {
            // Icon fills the disc flush — no inset gap under the border.
            ctx.save()
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.clip()
            ctx.drawImage(
              picture,
              x - radius,
              y - radius,
              radius * 2,
              radius * 2,
            )
            ctx.restore()
          } else if (n.kind === 'post' && settings.showUserIcons) {
            drawPostIcon(ctx, x, y, radius, darkTheme)
          } else if (personNode && settings.showUserIcons) {
            drawGenericPerson(ctx, x, y, radius)
          }

          const colorByTrust = !pathLayout && settings.colorByTrust
          if (colorByTrust || hasIcon) {
            const border = colorByTrust
              ? {
                  stroke: resolutionColor(n.resolution),
                  lineWidth: selected ? 2.25 : 1.6,
                }
              : iconBorderStyle(selected, darkTheme)
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.strokeStyle = border.stroke
            ctx.lineWidth = border.lineWidth / scale
            if (n.unidentifiedKind) ctx.setLineDash([3 / scale, 3 / scale])
            ctx.stroke()
            if (n.unidentifiedKind) ctx.setLineDash([])
          }

          if (settings.showLabels && globalScale > 0.55) {
            const colors = labelColors(darkTheme)
            const fontSize = 11 / globalScale
            const lineHeight = fontSize * 1.2
            const gap = 4 / globalScale
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            let textY = y + radius + gap
            ctx.font = `600 ${fontSize}px sans-serif`
            ctx.fillStyle = colors.primary
            ctx.fillText(n.label, x, textY)
            if (n.subtitle) {
              textY += lineHeight
              ctx.font = `${fontSize * 0.9}px sans-serif`
              ctx.fillStyle = colors.secondary
              ctx.fillText(n.subtitle, x, textY)
            }
          }
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as GraphVizNode
          const r = n.kind === 'aggregate' ? 14 : 10
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
        }}
      />
    </div>
  )
}
