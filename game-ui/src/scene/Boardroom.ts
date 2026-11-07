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
const TABLE = { length: 4.2, width: 1.4, height: 0.76 }
const UP = new THREE.Vector3(0, 1, 0)
/**
 * Seat origin to table edge. The Mixamo seated clips put the shoulders about 5 cm in front of
 * the seat origin with 0.46 m arms, and the typing clip's hands land 0.35 m forward at desk
 * height, so the edge has to be close for hands to reach the tabletop.
 */
const EDGE_GAP = 0.27
/** Where resting hands go, in seat space (+X is the character's left, +Z its front). */
const HAND_REST = { x: 0.235, y: TABLE.height + 0.03, z: EDGE_GAP + 0.07 }
/** How far resting fingers open from the clip's clasped pose toward the open bind pose. */
const FINGER_RELAX = 0.6
/** Share of the clip's hand movement kept on top of the resting hands. Low keeps hands calm. */
const GESTURE_SCALE = 0.15

interface Seat {
  position: THREE.Vector3
  yaw: number
}

/** Seat 0 is the head of the table nearest the camera, then around the table. */
function makeSeats(): Seat[] {
  const side = TABLE.width / 2 + EDGE_GAP
  const end = TABLE.length / 2 + EDGE_GAP
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
    this.findArms()
    this.setMood('sit', 0)
    this.measureRest()
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

  /** Remember where the seated clip puts each hand; talking gestures are offsets from it. */
  measureRest() {
    if (!this.mixer) return
    this.animate(0)
    for (const arm of this.arms) arm.rest = this.group.worldToLocal(arm.hand.getWorldPosition(new THREE.Vector3()))
  }

  /**
   * Two bone IK that keeps the hands resting on the tabletop in every mood, applied after the
   * animation pose. The body still plays the full clip; only a small share of the clip's hand
   * movement (GESTURE_SCALE) is kept, so the hands stay calm.
   */
  placeHands(_dt: number) {
    const w = this.handWeight
    if (w < 0.01) return
    const toWorld = this.group.getWorldQuaternion(new THREE.Quaternion())
    for (const arm of this.arms) {
      const animated = this.group.worldToLocal(arm.hand.getWorldPosition(new THREE.Vector3()))
      const gesture = animated.clone().sub(arm.rest).multiplyScalar(GESTURE_SCALE)
      const target = new THREE.Vector3(HAND_REST.x * arm.side, HAND_REST.y, HAND_REST.z).add(gesture)
      target.y = Math.max(target.y, HAND_REST.y)
      target.lerpVectors(animated, target, w)
      const pole = new THREE.Vector3(0.6 * arm.side, -0.5, -0.6).normalize().applyQuaternion(toWorld)
      solveTwoBone(arm, this.group.localToWorld(target), pole)
      orientHand(arm, new THREE.Vector3(-0.25 * arm.side, -0.12, 1).normalize().applyQuaternion(toWorld), w)
    }
    for (const finger of this.fingers) finger.bone.quaternion.slerp(finger.open, FINGER_RELAX * w)
  }

  arms: Arm[] = []
  handWeight = 1
  private overridden: THREE.Bone[] = []
  private animatedPose: THREE.Quaternion[] = []

  /**
   * Advance the animation. three.js only writes a bone when its animated value changes, so a
   * constant clip like `sit` would leave last frame's IK and head turn in place and they would
   * compound. Restoring the animated pose of the overridden bones first prevents that.
   */
  animate(dt: number) {
    if (!this.mixer) return
    this.overridden.forEach((bone, i) => bone.quaternion.copy(this.animatedPose[i]))
    this.mixer.update(dt)
    this.overridden.forEach((bone, i) => this.animatedPose[i].copy(bone.quaternion))
    this.group.updateMatrixWorld(true)
  }

  findArms() {
    const bones = new Map<string, THREE.Bone>()
    this.model?.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig\d*/, ''), o as THREE.Bone)
    })
    this.arms = (['Left', 'Right'] as const).flatMap((side) => {
      const upper = bones.get(`${side}Arm`)
      const fore = bones.get(`${side}ForeArm`)
      const hand = bones.get(`${side}Hand`)
      const middle = bones.get(`${side}HandMiddle1`)
      const index = bones.get(`${side}HandIndex1`)
      const pinky = bones.get(`${side}HandPinky1`)
      if (!upper || !fore || !hand || !middle || !index || !pinky) return []
      return [{ side: side === 'Left' ? 1 : -1, upper, fore, hand, middle, index, pinky, rest: new THREE.Vector3() } as Arm]
    })
    // Called before any clip plays, so current rotations are the open-handed bind pose.
    this.fingers = [...bones.entries()]
      .filter(([name]) => /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[1-3]$/.test(name))
      .map(([, bone]) => ({ bone, open: bone.quaternion.clone() }))
    this.overridden = [
      ...this.arms.flatMap((arm) => [arm.upper, arm.fore, arm.hand]),
      ...this.fingers.map((f) => f.bone),
      ...(this.head ? [this.head] : []),
    ]
    this.animatedPose = this.overridden.map((bone) => bone.quaternion.clone())
  }

  private fingers: { bone: THREE.Bone; open: THREE.Quaternion }[] = []
}

interface Arm {
  /** +1 for the character's left (its +X), -1 for its right. */
  side: 1 | -1
  upper: THREE.Bone
  fore: THREE.Bone
  hand: THREE.Bone
  middle: THREE.Bone
  index: THREE.Bone
  pinky: THREE.Bone
  rest: THREE.Vector3
}

const position = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3())

/** Rotate a bone in world space, keeping the result as a local rotation. */
function rotateWorld(bone: THREE.Object3D, rotation: THREE.Quaternion) {
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rotation)
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion())
  bone.quaternion.copy(parent.invert().multiply(world))
  bone.updateMatrixWorld(true)
}

function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  rotateWorld(bone, new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()))
}

function solveTwoBone(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3) {
  const a = position(arm.upper)
  const b = position(arm.fore)
  const c = position(arm.hand)
  const l1 = a.distanceTo(b)
  const l2 = b.distanceTo(c)
  const toTarget = target.clone().sub(a)
  const d = THREE.MathUtils.clamp(toTarget.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999)
  const dir = toTarget.normalize()
  const cos = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize()
  const elbow = a.clone().addScaledVector(dir, l1 * cos).addScaledVector(bend, l1 * Math.sqrt(1 - cos * cos))
  aim(arm.upper, b.clone().sub(a), elbow.clone().sub(a))
  const b2 = position(arm.fore)
  aim(arm.fore, position(arm.hand).sub(b2), a.clone().addScaledVector(dir, d).sub(b2))
}

/** Point the fingers forward and turn the palm down, blended by weight. */
function orientHand(arm: Arm, forward: THREE.Vector3, weight: number) {
  const hand = position(arm.hand)
  const current = position(arm.middle).sub(hand).normalize()
  rotateWorld(arm.hand, new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(current, forward), weight))
  const dir = position(arm.middle).sub(position(arm.hand)).normalize()
  const across = position(arm.index).sub(position(arm.pinky))
  const palm = across.cross(dir).multiplyScalar(-arm.side)
  const down = new THREE.Vector3(0, -1, 0)
  const flat = (v: THREE.Vector3) => v.addScaledVector(dir, -v.dot(dir)).normalize()
  const p = flat(palm)
  const q = flat(down)
  const angle = Math.atan2(dir.dot(p.clone().cross(q)), p.dot(q))
  rotateWorld(arm.hand, new THREE.Quaternion().setFromAxisAngle(dir, angle * weight))
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
      // props.json: { conventions: { front: "+Z", origin: base at Y=0 }, models: [{ id, file, ... }] }
      const manifest = (await response.json()) as { models: Entry[] }
      const entries = manifest.models
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
        this.placeProp(await load('clock'), new THREE.Vector3(2.0, 1.95, -3.56), 0),
        this.placeProp(await load('speaker'), new THREE.Vector3(0, TABLE.height, 0), 0),
        // The TRELLIS wall display is not used: the live canvas screen shows phase and timer.
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
      // Props face +Z, like the characters, so a chair takes its seat's yaw.
      replacement.rotation.y = this.avatars[index].seat.yaw
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
      // Keyboard edge just past the table edge, where the typing clip's hands land.
      laptop.position.copy(avatar.seat.position).addScaledVector(toward, EDGE_GAP + 0.18).setY(TABLE.height + 0.008)
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
      avatar.animate(dt)
      avatar.placeHands(dt)
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
