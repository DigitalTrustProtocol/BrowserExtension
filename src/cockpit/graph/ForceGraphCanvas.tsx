import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import {
  DISTRUST_COLOR,
  hopColor,
  NEUTRAL_COLOR,
  resolutionColor,
  ROOT_COLOR,
  TRUST_COLOR,
  type GraphViewSettings,
  type GraphVizData,
  type GraphVizLink,
  type GraphVizNode,
} from './types'

export interface ForceGraphCanvasProps {
  data: GraphVizData
  settings: GraphViewSettings
  selectedId?: string
  rootId?: string
  onNodeClick: (node: GraphVizNode) => void
  /** When true, fix nodes into a left-to-right path layout. */
  pathLayout?: boolean
}

const NEUTRAL_FALLBACK = '#8b95a8'
const GENERIC_PERSON_COLOR = 'rgba(255, 255, 255, 0.92)'
const AGGREGATE_FILL = '#536471'
const NODE_BORDER = 'rgba(255, 255, 255, 0.85)'

function nodeSupportsIcon(node: GraphVizNode): boolean {
  return node.kind === 'pubkey' || node.kind === 'twitter_id'
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

export default function ForceGraphCanvas({
  data,
  settings,
  selectedId,
  onNodeClick,
  pathLayout = false,
}: ForceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<{
    d3Force?: (forceName: string, force?: unknown) => unknown
  } | null>(null)
  const imageCache = useRef(new Map<string, HTMLImageElement>())
  const positions = useRef(
    new Map<string, { x: number; y: number }>(),
  )
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [imageRevision, setImageRevision] = useState(0)

  const graphData = useMemo(() => {
    const nodes = data.nodes.map((node) => {
      const previous = positions.current.get(node.id)
      return {
        ...node,
        ...(previous ? { x: previous.x, y: previous.y } : {}),
      }
    })
    const byDepth = new Map<number, GraphVizNode[]>()
    const center =
      nodes.find((node) => node.isFocus) ??
      nodes.find((node) => node.isRoot)
    for (const node of nodes) {
      const visualDepth =
        settings.layout === 'radial' && center
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
    if (pathLayout) {
      const depths = [...byDepth.keys()].sort((a, b) => a - b)
      for (const depth of depths) {
        const column = byDepth.get(depth) ?? []
        column.forEach((node, index) => {
          node.fx = depth * 160 - ((depths.length - 1) * 160) / 2
          node.fy = (index - (column.length - 1) / 2) * 72
        })
      }
    } else if (settings.layout === 'radial') {
      for (const [depth, ring] of byDepth) {
        ring.forEach((node, index) => {
          const angle = (index / Math.max(1, ring.length)) * Math.PI * 2
          const radius = depth * 95
          node.fx = Math.cos(angle) * radius
          node.fy = Math.sin(angle) * radius
        })
      }
    } else if (center) {
      // Keep the requested focus stable while new neighborhoods settle.
      center.fx = 0
      center.fy = 0
    }
    return {
      nodes,
      links: data.links.map((link) => ({ ...link })),
    }
  }, [data, pathLayout, settings.layout])

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

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph2D
        ref={fgRef as never}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        linkSource="source"
        linkTarget="target"
        linkDirectionalArrowLength={settings.showArrows ? 4 : 0}
        linkDirectionalArrowRelPos={1}
        linkWidth={(link) =>
          (link as GraphVizLink).eventId.startsWith('agg:') ? 1 : 1.5
        }
        linkColor={(link) => {
          const l = link as GraphVizLink
          if (l.eventId.startsWith('agg:')) return NEUTRAL_COLOR
          return l.value === 1 ? TRUST_COLOR : DISTRUST_COLOR
        }}
        cooldownTicks={
          pathLayout || settings.layout === 'radial' ? 0 : 80
        }
        onEngineTick={() => {
          for (const node of graphData.nodes) {
            if (node.x !== undefined && node.y !== undefined) {
              positions.current.set(node.id, { x: node.x, y: node.y })
            }
          }
        }}
        onNodeClick={(node) => onNodeClick(node as GraphVizNode)}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          void imageRevision
          void selectedId
          const n = node as GraphVizNode
          const x = n.x ?? 0
          const y = n.y ?? 0
          const humanNode = nodeSupportsIcon(n)
          const radius = n.isRoot ? 11 : n.kind === 'aggregate' ? 14 : humanNode ? 9 : 7

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
          if (settings.colorBy === 'distance') {
            fill = hopColor(n.depth)
          } else {
            fill = n.isRoot ? ROOT_COLOR : resolutionColor(n.resolution)
          }
          // Slightly brighter fill for expanded hubs (no ring).
          if (n.expanded) {
            fill = fill === NEUTRAL_FALLBACK ? '#a8b0c0' : fill
          }
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fillStyle = fill
          ctx.fill()
          const picture =
            settings.showUserIcons && n.picture
              ? imageCache.current.get(n.picture)
              : undefined
          if (picture?.complete && picture.naturalWidth > 0) {
            ctx.save()
            ctx.beginPath()
            ctx.arc(x, y, radius - 0.5, 0, Math.PI * 2)
            ctx.clip()
            ctx.drawImage(
              picture,
              x - radius + 0.5,
              y - radius + 0.5,
              radius * 2 - 1,
              radius * 2 - 1,
            )
            ctx.restore()
            ctx.beginPath()
            ctx.arc(x, y, radius - 0.5, 0, Math.PI * 2)
            ctx.strokeStyle = NODE_BORDER
            ctx.lineWidth = 1.5 / Math.max(globalScale, 0.5)
            ctx.stroke()
          } else if (humanNode) {
            drawGenericPerson(ctx, x, y, radius)
            ctx.beginPath()
            ctx.arc(x, y, radius - 0.5, 0, Math.PI * 2)
            ctx.strokeStyle = NODE_BORDER
            ctx.lineWidth = 1.25 / Math.max(globalScale, 0.5)
            ctx.stroke()
          }
          if (settings.showLabels && globalScale > 0.55) {
            const fontSize = 11 / globalScale
            const lineHeight = fontSize * 1.2
            const gap = 4 / globalScale
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            let textY = y + radius + gap
            ctx.font = `600 ${fontSize}px sans-serif`
            ctx.fillStyle = 'rgba(15, 20, 25, 0.88)'
            ctx.fillText(n.label, x, textY)
            if (n.subtitle) {
              textY += lineHeight
              ctx.font = `${fontSize * 0.9}px sans-serif`
              ctx.fillStyle = 'rgba(83, 100, 113, 0.95)'
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
