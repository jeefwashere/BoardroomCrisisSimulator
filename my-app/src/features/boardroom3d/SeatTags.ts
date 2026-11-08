/**
 * Name tags for the seated characters and the hub agent, drawn as HTML over the 3D canvas.
 * Ported from the standalone 3D UI (`game-ui/src/scene/SeatTags.ts` on `arjun/game-ui-3d`).
 *
 * Unlike CSS2DRenderer, tags are laid out in screen space every frame: each is anchored above
 * its character's head, scaled by distance, and pushed upward when it would overlap a tag that
 * has priority (the speaker, a hovered player, then nearer characters). A thin stem links a
 * displaced tag back to its character.
 */
import * as THREE from 'three'

export interface TagContent {
  name: string
  initial: string
  role: string
  /** Accent colour of the tag (member avatar colour, or the agent's accent). */
  color: string
  speaking: boolean
  away: boolean
  /** The hub agent's tag uses the AI style. */
  agent?: boolean
}

interface Tag {
  root: HTMLDivElement
  stem: HTMLDivElement
  width: number
  height: number
  key: string
  priority: number
}

interface Placed {
  left: number
  top: number
  width: number
  height: number
}

const GAP = 4

export class SeatTags {
  readonly element = document.createElement('div')
  private tags: Tag[]

  constructor(count: number) {
    this.element.className = 'board3d-labels'
    this.tags = Array.from({ length: count }, () => {
      const stem = document.createElement('div')
      stem.className = 'board3d-stem'
      const root = document.createElement('div')
      root.className = 'board3d-tag'
      this.element.append(stem, root)
      return { root, stem, width: 0, height: 0, key: '', priority: 0 }
    })
  }

  /** Update a tag's content; null hides it. Cheap when nothing changed. */
  set(index: number, content: TagContent | null) {
    const tag = this.tags[index]
    const key = content ? JSON.stringify(content) : ''
    if (key === tag.key) return
    tag.key = key
    if (!content) {
      tag.root.style.display = 'none'
      tag.stem.style.display = 'none'
      return
    }
    tag.root.style.display = ''
    tag.root.className = ['board3d-tag', content.speaking && 'is-speaking', content.away && 'is-away', content.agent && 'is-agent']
      .filter(Boolean)
      .join(' ')
    tag.root.style.setProperty('--tag-color', content.color)
    tag.root.replaceChildren(
      el('span', 'board3d-tag-dot', content.initial),
      el('span', 'board3d-tag-body', null, [el('strong', '', content.name), el('small', '', content.role)]),
      ...(content.speaking ? [el('span', 'board3d-tag-wave', null, [el('i'), el('i'), el('i'), el('i')])] : []),
    )
    tag.priority = content.speaking ? 2 : content.agent ? 1 : 0
    tag.width = tag.root.offsetWidth
    tag.height = tag.root.offsetHeight
  }

  /** Position tags for this frame. anchors are world points above each head, or null to hide. */
  layout(anchors: (THREE.Vector3 | null)[], camera: THREE.PerspectiveCamera, width: number, height: number) {
    const projected = anchors.map((anchor, index) => {
      const tag = this.tags[index]
      if (!anchor || !tag.key) return null
      const ndc = anchor.clone().project(camera)
      if (ndc.z < -1 || ndc.z > 1) return null
      const distance = camera.position.distanceTo(anchor)
      const scale = THREE.MathUtils.clamp(4 / distance, 0.88, 1.08)
      return { index, x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, distance, scale }
    })
    const order = projected
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => this.tags[b.index].priority - this.tags[a.index].priority || a.distance - b.distance)

    const placed: Placed[] = []
    const visible = new Set<number>()
    for (const p of order) {
      const tag = this.tags[p.index]
      const w = tag.width * p.scale
      const h = tag.height * p.scale
      const left = p.x - w / 2
      let top = p.y - h
      for (let attempt = 0; attempt < 12; attempt++) {
        const hit = placed.find((o) => left < o.left + o.width + GAP && left + w + GAP > o.left && top < o.top + o.height + GAP && top + h + GAP > o.top)
        if (!hit) break
        top = hit.top - h - GAP
      }
      placed.push({ left, top, width: w, height: h })
      visible.add(p.index)
      tag.root.style.display = ''
      tag.root.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) scale(${p.scale.toFixed(3)})`
      tag.root.style.zIndex = String(100 + tag.priority * 50 - Math.round(p.distance * 4))
      tag.root.style.opacity = p.distance > 7.5 ? '0.8' : ''
      const stemLength = p.y - (top + h)
      if (stemLength > 3) {
        tag.stem.style.display = ''
        tag.stem.style.transform = `translate(${p.x.toFixed(1)}px, ${(top + h).toFixed(1)}px)`
        tag.stem.style.height = `${stemLength.toFixed(1)}px`
        tag.stem.style.zIndex = tag.root.style.zIndex
      } else {
        tag.stem.style.display = 'none'
      }
    }
    this.tags.forEach((tag, index) => {
      if (visible.has(index)) return
      tag.root.style.display = 'none'
      tag.stem.style.display = 'none'
    })
  }
}

function el(tag: string, className = '', text: string | null = null, children: Node[] = []) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== null) node.textContent = text
  node.append(...children)
  return node
}
