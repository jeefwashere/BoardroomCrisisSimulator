/**
 * The 3D boardroom: a room, a table, ten seats and Mixamo-rigged characters that sit,
 * talk, react and turn their heads toward the active speaker.
 *
 * Characters come from public/models/characters (exported by tools/export_characters.py).
 * They share one skeleton, so the clips in animations.glb drive all of them. Props are read
 * from public/models/props/props.json when present; simple geometry stands in otherwise.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

export const CHARACTER_IDS = [
  '01-coo', '02-cfo', '03-cto', '04-general-counsel', '05-head-of-hr',
  '06-head-of-communications', '07-marketing-director', '08-sales-manager',
  '09-operations-manager', '10-project-manager',
]

export type Mood = 'sit' | 'talk' | 'disbelief' | 'typing'

export interface SeatState {
  memberId: string
  name: string
  role: string
  isSelf: boolean
  connected: boolean
  voted: boolean
  speaking: boolean
  mood: Mood
}

export interface SceneState {
  seats: SeatState[]
  speakerId: string | null
  screenTitle: string
  screenSubtitle: string
  deadline: number | null
}

const MODELS = `${import.meta.env.BASE_URL}models/`
const TABLE = { length: 4.2, width: 1.4, height: 0.75 }
const UP = new THREE.Vector3(0, 1, 0)

interface Seat {
  position: THREE.Vector3
  yaw: number
}

/** Seat 0 is the head of the table nearest the camera, then around the table. */
function makeSeats(): Seat[] {
  const side = TABLE.width / 2 + 0.5
  const end = TABLE.length / 2 + 0.55
  const xs = [1.5, 0.5, -0.5, -1.5]
  return [
    { position: new THREE.Vector3(end, 0, 0), yaw: -Math.PI / 2 },
    ...xs.map((x) => ({ position: new THREE.Vector3(x, 0, side), yaw: Math.PI })),
    { position: new THREE.Vector3(-end, 0, 0), yaw: Math.PI / 2 },
    ...[...xs].reverse().map((x) => ({ position: new THREE.Vector3(x, 0, -side), yaw: 0 })),
  ]
}

class Avatar {
  readonly group = new THREE.Group()
  readonly label: CSS2DObject
  readonly labelEl: HTMLDivElement
  model: THREE.Object3D | null = null
  mixer: THREE.AnimationMixer | null = null
  actions = new Map<Mood, THREE.AnimationAction>()
  head: THREE.Bone | null = null
  hips: THREE.Bone | null = null
  mood: Mood | null = null
  yaw = 0

  constructor(readonly seat: Seat) {
    this.group.position.copy(seat.position)
    this.group.rotation.y = seat.yaw
    this.labelEl = document.createElement('div')
    this.labelEl.className = 'seat-label empty'
    this.label = new CSS2DObject(this.labelEl)
    this.label.position.set(0, 1.45, 0)
    this.group.add(this.label)
  }

  attach(gltf: GLTF, clips: THREE.AnimationClip[]) {
    this.model = gltf.scene
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.frustumCulled = false
      }
      const bone = o as THREE.Bone
      if (bone.isBone && /Head$/.test(bone.name) && !/HeadTop/.test(bone.name)) this.head = bone
      if (bone.isBone && /Hips$/.test(bone.name)) this.hips = bone
    })
    this.group.add(this.model)
    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip)
      action.time = Math.random() * clip.duration // keep characters out of step
      this.actions.set(clip.name as Mood, action)
    }
    this.setMood('sit', 0)
  }

  setMood(mood: Mood, fade = 0.5) {
    if (mood === this.mood || !this.actions.has(mood)) return
    const next = this.actions.get(mood)!
    const previous = this.mood ? this.actions.get(this.mood) : null
    next.reset()
    next.time = Math.random() * next.getClip().duration
    next.setEffectiveWeight(1).play()
    if (previous && fade > 0) previous.crossFadeTo(next, fade, false)
    else previous?.stop()
    this.mood = mood
  }

  /** Turn the head toward a world point after the animation pose is applied. */
  lookAt(target: THREE.Vector3 | null, dt: number) {
    if (!this.head || !this.head.parent) return
    let desired = 0
    if (target) {
      const local = this.group.worldToLocal(target.clone())
      const headLocal = this.group.worldToLocal(this.head.getWorldPosition(new THREE.Vector3()))
      desired = THREE.MathUtils.clamp(Math.atan2(local.x - headLocal.x, local.z - headLocal.z), -1.1, 1.1)
    }
    this.yaw = THREE.MathUtils.damp(this.yaw, desired, 4, dt)
    const world = this.head.getWorldQuaternion(new THREE.Quaternion())
    world.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw))
    const parent = this.head.parent.getWorldQuaternion(new THREE.Quaternion())
    this.head.quaternion.copy(parent.invert().multiply(world))
  }

  headPosition(out = new THREE.Vector3()) {
    return this.head ? this.head.getWorldPosition(out) : out.copy(this.group.position).setY(1.2)
  }
}

export class Boardroom {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60)
  private controls: OrbitControls
  private clock = new THREE.Clock()
  private avatars: Avatar[]
  private chairs: THREE.Object3D[] = []
  private laptops: THREE.Object3D[] = []
  private screenCanvas = document.createElement('canvas')
  private screenTexture: THREE.CanvasTexture
  private screenKey = ''
  private state: SceneState | null = null
  private focus = new THREE.Vector3(-0.4, 0.95, 0)
  private frame = 0
  private resizeObserver: ResizeObserver
  private loader = new GLTFLoader()
  private seatOffset = new THREE.Vector3(0, 0.47, -0.08)
  onProgress: (loaded: number, total: number) => void = () => {}

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.domElement.className = 'scene-labels'
    container.appendChild(this.labels.domElement)

    this.camera.position.set(5.6, 2.7, 0.0)
    this.controls = new OrbitControls(this.camera, this.labels.domElement)
    this.controls.target.copy(this.focus)
    this.controls.enableDamping = true
    this.controls.minDistance = 2.2
    this.controls.maxDistance = 9
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.enablePan = false

    this.screenCanvas.width = 1024
    this.screenCanvas.height = 576
    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas)
    this.screenTexture.colorSpace = THREE.SRGBColorSpace

    this.buildRoom()
    this.avatars = makeSeats().map((seat) => {
      const avatar = new Avatar(seat)
      this.scene.add(avatar.group)
      return avatar
    })
    this.buildFurniture()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.renderer.setAnimationLoop(() => this.render())
    void this.loadModels()
    void this.loadProps()
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.container.replaceChildren()
  }

  update(state: SceneState) {
    this.state = state
    this.avatars.forEach((avatar, index) => {
      const seat = state.seats[index]
      avatar.group.visible = Boolean(seat)
      this.chairs[index]?.position.copy(this.chairPosition(avatar))
      if (this.laptops[index]) this.laptops[index].visible = Boolean(seat)
      if (!seat) return
      avatar.setMood(seat.mood)
      avatar.labelEl.className = [
        'seat-label',
        seat.speaking && 'speaking',
        seat.isSelf && 'self',
        !seat.connected && 'away',
      ].filter(Boolean).join(' ')
      avatar.labelEl.innerHTML = ''
      const name = document.createElement('strong')
      name.textContent = seat.isSelf ? `${seat.name} (you)` : seat.name
      const role = document.createElement('span')
      role.textContent = seat.voted ? `${seat.role} · voted` : seat.role
      avatar.labelEl.append(name, role)
    })
  }

  // ---- loading ----

  private async loadModels() {
    const total = CHARACTER_IDS.length + 1
    let loaded = 0
    const tick = () => this.onProgress(++loaded, total)
    const library = await this.loader.loadAsync(`${MODELS}characters/animations.glb`)
    tick()
    const clips = library.animations
    await Promise.all(
      CHARACTER_IDS.map(async (id, index) => {
        const gltf = await this.loader.loadAsync(`${MODELS}characters/${id}.glb`)
        this.avatars[index].attach(gltf, clips)
        if (index === 0) this.calibrateSeat(this.avatars[0])
        tick()
      }),
    )
    this.avatars.forEach((avatar, index) => this.chairs[index]?.position.copy(this.chairPosition(avatar)))
  }

  /** Measure where the seated pose puts the hips so chairs sit under every character. */
  private calibrateSeat(avatar: Avatar) {
    if (!avatar.mixer || !avatar.hips) return
    avatar.mixer.update(0)
    avatar.group.updateMatrixWorld(true)
    const hips = avatar.group.worldToLocal(avatar.hips.getWorldPosition(new THREE.Vector3()))
    this.seatOffset.set(hips.x, Math.max(0.38, hips.y - 0.1), hips.z - 0.06)
  }

  private chairPosition(avatar: Avatar) {
    const offset = this.seatOffset.clone().setY(0).applyAxisAngle(UP, avatar.seat.yaw)
    return avatar.seat.position.clone().add(offset)
  }

  private async loadProps() {
    try {
      const response = await fetch(`${MODELS}props/props.json`)
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) return
      type Entry = { file: string }
      const manifest = (await response.json()) as Entry[] | { props: Entry[] | Record<string, Entry> }
      const entries: Entry[] = Array.isArray(manifest) ? manifest : Object.values(manifest.props)
      const find = (word: string) => entries.find((entry) => entry.file.toLowerCase().includes(word))
      const load = async (word: string) => {
        const entry = find(word)
        if (!entry) return null
        const gltf = await this.loader.loadAsync(`${MODELS}props/${entry.file.split('/').pop()}`)
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        return gltf.scene
      }
      await Promise.all([
        this.swapProp(await load('table'), 'table', (model) => model.position.set(0, 0, 0), true),
        this.swapChairs(await load('chair')),
        this.placeProp(await load('credenza'), new THREE.Vector3(0, 0, -3.15), 0),
        this.placeProp(await load('plant'), new THREE.Vector3(-4.6, 0, -2.9), 0),
        this.placeProp((await load('plant'))?.clone() ?? null, new THREE.Vector3(-4.6, 0, 2.9), 0),
        this.placeProp(await load('clock'), new THREE.Vector3(2.2, 2.25, -3.37), 0),
        this.placeProp(await load('speaker'), new THREE.Vector3(0, TABLE.height, 0), 0),
        this.swapLaptops(await load('laptop')),
      ])
    } catch (error) {
      console.warn('[boardroom] props not loaded', error)
    }
  }

  private fallbacks = new Map<string, THREE.Object3D>()

  private async swapProp(model: THREE.Object3D | null, key: string, place: (m: THREE.Object3D) => void, rotate = false) {
    if (!model) return
    if (rotate) model.rotation.y = 0
    place(model)
    this.fallbacks.get(key)?.removeFromParent()
    this.scene.add(model)
  }

  private async placeProp(model: THREE.Object3D | null, position: THREE.Vector3, yaw: number) {
    if (!model) return
    model.position.copy(position)
    model.rotation.y = yaw
    this.scene.add(model)
  }

  private async swapChairs(model: THREE.Object3D | null) {
    if (!model) return
    this.chairs.forEach((chair, index) => {
      const replacement = model.clone()
      // Chair models face -Z in glTF terms after export (backrest at +Z); turn to face the table.
      replacement.rotation.y = this.avatars[index].seat.yaw + Math.PI
      replacement.position.copy(chair.position)
      chair.removeFromParent()
      this.scene.add(replacement)
      this.chairs[index] = replacement
    })
  }

  private async swapLaptops(model: THREE.Object3D | null) {
    if (!model) return
    this.laptops.forEach((laptop, index) => {
      const replacement = model.clone()
      replacement.position.copy(laptop.position)
      replacement.rotation.copy(laptop.rotation)
      replacement.visible = laptop.visible
      laptop.removeFromParent()
      this.scene.add(replacement)
      this.laptops[index] = replacement
    })
  }

  // ---- static scene ----

  private buildRoom() {
    this.scene.background = new THREE.Color('#e9e5da')
    this.scene.fog = new THREE.Fog('#e9e5da', 14, 30)

    const hemi = new THREE.HemisphereLight('#fffaf0', '#6b5a48', 1.25)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff4e2', 2.2)
    sun.position.set(3.5, 6, 2.5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -6
    sun.shadow.camera.right = 6
    sun.shadow.camera.top = 5
    sun.shadow.camera.bottom = -5
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    this.scene.add(sun)
    const fill = new THREE.PointLight('#ffd9b0', 6, 9, 1.6)
    fill.position.set(0, 2.6, 0)
    this.scene.add(fill)

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 7.2), new THREE.MeshStandardMaterial({ color: '#8c7a66', roughness: 0.85 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.6), new THREE.MeshStandardMaterial({ color: '#33473d', roughness: 1 }))
    rug.rotation.x = -Math.PI / 2
    rug.position.y = 0.004
    rug.receiveShadow = true
    this.scene.add(rug)

    const wall = new THREE.MeshStandardMaterial({ color: '#f1eee5', roughness: 0.95 })
    const back = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 3.2), wall)
    back.position.set(0, 1.6, -3.6)
    back.receiveShadow = true
    this.scene.add(back)
    const left = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.2), wall)
    left.position.set(-5.25, 1.6, 0)
    left.rotation.y = Math.PI / 2
    this.scene.add(left)
    const front = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 3.2), wall)
    front.position.set(0, 1.6, 3.6)
    front.rotation.y = Math.PI
    this.scene.add(front)

    // Window band on the far wall.
    const glass = new THREE.MeshBasicMaterial({ color: '#cfdde0' })
    for (const z of [-2.2, 0, 2.2]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.7), glass)
      pane.position.set(-5.24, 1.75, z)
      pane.rotation.y = Math.PI / 2
      this.scene.add(pane)
    }
    const trim = new THREE.MeshStandardMaterial({ color: '#213c32', roughness: 0.6 })
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.1, 0.03), trim)
    skirting.position.set(0, 0.05, -3.58)
    this.scene.add(skirting)

    // Wall display with the live phase and timer.
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.22, 0.06), new THREE.MeshStandardMaterial({ color: '#141614', roughness: 0.4 }))
    bezel.position.set(-0.4, 1.75, -3.56)
    this.scene.add(bezel)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.125), new THREE.MeshBasicMaterial({ map: this.screenTexture, toneMapped: false }))
    screen.position.set(-0.4, 1.75, -3.525)
    this.scene.add(screen)
  }

  private buildFurniture() {
    const walnut = new THREE.MeshStandardMaterial({ color: '#5a3a26', roughness: 0.5 })
    const table = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.length, 0.06, TABLE.width), walnut)
    top.position.y = TABLE.height - 0.03
    const base = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.4, metalness: 0.5 })
    for (const x of [-1.3, 1.3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, TABLE.height - 0.06, 0.9), base)
      leg.position.set(x, (TABLE.height - 0.06) / 2, 0)
      table.add(leg)
    }
    table.add(top)
    table.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
    this.fallbacks.set('table', table)
    this.scene.add(table)

    const leather = new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.55 })
    const steel = new THREE.MeshStandardMaterial({ color: '#8a8d90', roughness: 0.3, metalness: 0.8 })
    const laptopBody = new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.35, metalness: 0.6 })
    for (const avatar of this.avatars) {
      const chair = new THREE.Group()
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.5), leather)
      seat.position.y = 0.44
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.08), leather)
      back.position.set(0, 0.8, -0.24)
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38), steel)
      post.position.y = 0.2
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 20), steel)
      foot.position.y = 0.02
      chair.add(seat, back, post, foot)
      chair.rotation.y = avatar.seat.yaw
      chair.traverse((o) => {
        o.castShadow = true
        o.receiveShadow = true
      })
      this.chairs.push(chair)
      this.scene.add(chair)

      const laptop = new THREE.Group()
      const base2 = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.015, 0.23), laptopBody)
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.22, 0.01), laptopBody)
      lid.position.set(0, 0.1, -0.12)
      lid.rotation.x = -0.25
      laptop.add(base2, lid)
      const toward = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, avatar.seat.yaw)
      laptop.position.copy(avatar.seat.position).addScaledVector(toward, 0.72).setY(TABLE.height + 0.008)
      laptop.rotation.y = avatar.seat.yaw + Math.PI
      laptop.traverse((o) => (o.castShadow = true))
      this.laptops.push(laptop)
      this.scene.add(laptop)
    }
  }

  // ---- frame ----

  private insets = { left: 0, right: 0, top: 0, bottom: 0 }

  /** Pixels covered by HUD panels; the view centre moves into the remaining clear area. */
  setInsets(insets: { left: number; right: number; top: number; bottom: number }) {
    this.insets = insets
    this.resize()
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.camera.aspect = w / h
    const dx = (this.insets.left - this.insets.right) / 2
    const dy = (this.insets.top - this.insets.bottom) / 2
    if (dx || dy) this.camera.setViewOffset(w, h, -dx, -dy, w, h)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
  }

  private drawScreen() {
    const state = this.state
    const seconds = state?.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : null
    const clock = seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    const key = `${state?.screenTitle}|${state?.screenSubtitle}|${clock}`
    if (key === this.screenKey) return
    this.screenKey = key
    const ctx = this.screenCanvas.getContext('2d')!
    const { width: w, height: h } = this.screenCanvas
    const gradient = ctx.createLinearGradient(0, 0, w, h)
    gradient.addColorStop(0, '#16281f')
    gradient.addColorStop(1, '#213c32')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#ae5238'
    ctx.fillRect(64, 70, 90, 8)
    ctx.fillStyle = '#e9e5da'
    ctx.font = '600 30px "Segoe UI", Arial, sans-serif'
    ctx.fillText((state?.screenSubtitle ?? 'Connecting').toUpperCase(), 64, 130)
    ctx.font = '600 58px "Segoe UI", Arial, sans-serif'
    wrap(ctx, state?.screenTitle ?? 'Boardroom Crisis Simulator', 64, 210, w - 128, 68, 3)
    if (clock) {
      ctx.font = '300 120px "Segoe UI", Arial, sans-serif'
      ctx.fillStyle = seconds !== null && seconds <= 10 ? '#e58a6b' : '#f6f5ef'
      ctx.fillText(clock, 64, h - 70)
    }
    this.screenTexture.needsUpdate = true
  }

  private render() {
    const dt = Math.min(this.clock.getDelta(), 0.1)
    this.frame += 1
    const state = this.state
    const speakerIndex = state ? state.seats.findIndex((s) => s.memberId === state.speakerId) : -1
    const speaker = speakerIndex >= 0 ? this.avatars[speakerIndex] : null
    const speakerHead = speaker?.model ? speaker.headPosition() : null

    for (const [index, avatar] of this.avatars.entries()) {
      if (!avatar.mixer || !avatar.group.visible) continue
      avatar.mixer.update(dt)
      avatar.group.updateMatrixWorld(true)
      const target = avatar === speaker ? this.camera.position : speakerHead
      avatar.lookAt(state?.seats[index]?.mood === 'typing' ? null : target, dt)
    }

    // Ease the orbit target toward the active speaker.
    const goal = speakerHead ? new THREE.Vector3(-0.4, 0.95, 0).lerp(speakerHead, 0.35) : new THREE.Vector3(-0.4, 0.95, 0)
    this.focus.lerp(goal, 1 - Math.exp(-dt * 2))
    this.controls.target.copy(this.focus)
    this.controls.update()
    if (this.frame % 6 === 0) this.drawScreen()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
  const words = text.split(' ')
  let line = ''
  let lines = 0
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > width && line) {
      ctx.fillText(line, x, y + lines * lineHeight)
      line = word
      lines += 1
      if (lines === maxLines - 1) break
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, y + lines * lineHeight)
}
