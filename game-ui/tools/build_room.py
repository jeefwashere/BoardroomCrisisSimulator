"""Build, bake and export the boardroom shell for the three.js game.

Run with Blender 5.2 in background mode from the repository root:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python game-ui/tools/build_room.py -- [options]

Options (all optional):

    --samples N        Cycles samples for the lighting bake (default 384).
    --reuse-bake       Skip the Cycles bakes and reuse the raw EXR files in assets/room/bake.
                       Useful when only exposure, tone curve or JPEG settings change.
    --preview DIR      After exporting, render JPEG previews into DIR: room-preview.jpg from the
                       game camera and room-window.jpg from the room centre toward the window.
    --preview-only     Only build the scene and render a quick unbaked Cycles look at the
                       lighting from the game camera (for tuning lights). Its world shows
                       the skyline JPEG to camera rays through a Light Path switch, which
                       also changes how Cycles samples the sky as a light, so it reads
                       darker than the bake; judge final levels from --preview renders.
    --exposure X       Multiplier applied to the baked radiance before the tone curve (default 1).

Inputs live in assets/room (untracked, raw Poly Haven downloads, all CC0):

    sunset_jhbcentral_2k.hdr                  world lighting for the bake
    sunset_jhbcentral_tonemapped.jpg          source of game-ui/public/textures/sky/skyline.jpg
    textures/walnut_veneer_diff_2k.jpg        slats and door
    textures/poly_wool_herringbone_diff_2k.jpg  carpet
    textures/granite_tile_diff_2k.jpg         stone floor
    textures/beige_wall_001_diff_2k.jpg       warm plaster walls and ceiling

The prop GLBs in game-ui/public/models/props (table, ten chairs, credenza, two plants) are
loaded at the positions used by game-ui/src/scene/Boardroom.ts so they cast contact shadows
into the bake. They are never exported.

How it works. Everything is authored in three.js coordinates (metres, Y up) and converted to
Blender coordinates with three (x, y, z) -> Blender (x, -z, y), so the glTF exporter's +Y up
conversion brings it back unchanged. Surfaces are grouped into four atlases (back wall, side
walls and window frame, floor, ceiling); each atlas is one mesh with a single lightmap UV that
is packed from metric, seam free islands (the slat wall is unrolled as one continuous strip per
chunk). Bake input materials use box projected Poly Haven textures in object space, so the
lightmap UV layout never affects texture orientation. For every atlas Cycles bakes, on the
Metal GPU, the diffuse lighting (direct plus indirect, without colour) at the lighting
resolution and the diffuse colour at the full resolution. The lighting is denoised with OpenImageDenoise
through the compositor, upsampled if needed, multiplied by the colour, passed through a soft
shoulder so values stay below about 0.92, and saved as a JPEG. The exported atlas materials are
Background shader materials, which the glTF exporter writes as KHR_materials_unlit. Light
emitting parts are separate meshes named Emit_* with an emissive colour, and the window glazing
is one mesh named Glass.
"""
import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ASSETS = os.path.join(REPO, "assets", "room")
TEX = os.path.join(ASSETS, "textures")
BAKE_DIR = os.path.join(ASSETS, "bake")
PROPS = os.path.join(REPO, "game-ui", "public", "models", "props")
OUT_DIR = os.path.join(REPO, "game-ui", "public", "models", "room")
SKY_JPG = os.path.join(REPO, "game-ui", "public", "textures", "sky", "skyline.jpg")
HDRI = os.path.join(ASSETS, "sunset_jhbcentral_2k.hdr")

sys.stdout.reconfigure(line_buffering=True)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None, cast=str):
    if name in argv:
        i = argv.index(name)
        if cast is bool:
            return True
        return cast(argv[i + 1])
    return default if cast is not bool else False


SAMPLES = arg("--samples", 384, int)
REUSE = arg("--reuse-bake", cast=bool)
PREVIEW_DIR = arg("--preview", None)
PREVIEW_ONLY = arg("--preview-only", cast=bool)
EXPOSURE = arg("--exposure", 1.0, float)

# Room interior in three.js coordinates.
X0, X1 = -5.25, 7.6
Z0, Z1 = -3.6, 3.6
H = 3.2
TABLE = dict(length=4.2, width=1.4, height=0.76)
EDGE_GAP = 0.27
SEAT_OFFSET_Z = -0.08

# The equirect u that faces three.js -X (the window wall). Blender's equirect lookup gives
# u = (pi - atan2(y, x)) / (2 pi), so -X normally samples u = 0. Rotating the lookup vector by
# WORLD_ROT_Z moves u = SKY_U_WEST onto -X.
SKY_U_WEST = 0.40
WORLD_ROT_Z = math.radians(-360.0 * SKY_U_WEST)  # -144 degrees for u = 0.40
WORLD_STRENGTH = 1.2

# Atlas name -> (colour resolution, lighting resolution, jpeg quality).
ATLASES = {
    "Room_Back": (4096, 2048, 86),
    "Room_Walls": (2048, 2048, 86),
    "Room_Floor": (4096, 2048, 84),
    "Room_Ceiling": (2048, 1024, 84),
}

AMBER = (1.0, 0.58, 0.28)
WARM = (1.0, 0.74, 0.5)


def B(x, y, z):
    """three.js position to Blender position."""
    return Vector((x, -z, y))


def V(x, y, z):
    return Vector((x, y, z))


# ---------------------------------------------------------------- scene setup

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "METAL"
    scene.cycles.device = "GPU"
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 6
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 2
    scene.cycles.sample_clamp_indirect = 6.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.unit_settings.system = "METRIC"
    return scene


# ---------------------------------------------------------------- materials

def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    return nt, nt.nodes, nt.links


def load_image(path, colorspace="sRGB"):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def mat_surface(name, color=(0.5, 0.5, 0.5), tex=None, size=1.0, gamma=1.0, bump=0.0,
                noise=0.0, noise_scale=(60, 60, 60), rough_axis=None):
    """Diffuse bake input. tex is box projected in object space, size metres per tile."""
    mat = bpy.data.materials.new(name)
    nt, n, l = _nodes(mat)
    out = n.new("ShaderNodeOutputMaterial")
    bsdf = n.new("ShaderNodeBsdfDiffuse")
    l.new(bsdf.outputs[0], out.inputs["Surface"])
    coord = n.new("ShaderNodeTexCoord")
    tint = n.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs["B"].default_value = (*color, 1.0)
    col_socket = tint.outputs["Result"]
    if tex:
        mapping = n.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1 / size, 1 / size, 1 / size)
        l.new(coord.outputs["Object"], mapping.inputs["Vector"])
        img = n.new("ShaderNodeTexImage")
        img.image = load_image(os.path.join(TEX, tex))
        img.projection = "BOX"
        img.projection_blend = 0.0
        l.new(mapping.outputs[0], img.inputs["Vector"])
        g = n.new("ShaderNodeGamma")
        g.inputs["Gamma"].default_value = gamma
        l.new(img.outputs["Color"], g.inputs["Color"])
        l.new(g.outputs[0], tint.inputs["A"])
        if bump > 0:
            bw = n.new("ShaderNodeRGBToBW")
            l.new(img.outputs["Color"], bw.inputs[0])
            bp = n.new("ShaderNodeBump")
            bp.inputs["Strength"].default_value = bump
            bp.inputs["Distance"].default_value = 0.002
            l.new(bw.outputs[0], bp.inputs["Height"])
            l.new(bp.outputs[0], bsdf.inputs["Normal"])
    else:
        tint.inputs["A"].default_value = (1, 1, 1, 1)
    if noise > 0:
        mapping = n.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = noise_scale
        l.new(coord.outputs["Object"], mapping.inputs["Vector"])
        tx = n.new("ShaderNodeTexNoise")
        tx.inputs["Scale"].default_value = 1.0
        tx.inputs["Detail"].default_value = 6.0
        l.new(mapping.outputs[0], tx.inputs["Vector"])
        mr = n.new("ShaderNodeMapRange")
        mr.inputs["To Min"].default_value = 1 - noise
        mr.inputs["To Max"].default_value = 1 + noise
        l.new(tx.outputs["Fac"], mr.inputs["Value"])
        m2 = n.new("ShaderNodeMix")
        m2.data_type = "RGBA"
        m2.blend_type = "MULTIPLY"
        m2.inputs["Factor"].default_value = 1.0
        l.new(col_socket, m2.inputs["A"])
        cmb = n.new("ShaderNodeCombineColor")
        for s in ("Red", "Green", "Blue"):
            l.new(mr.outputs[0], cmb.inputs[s])
        l.new(cmb.outputs[0], m2.inputs["B"])
        col_socket = m2.outputs["Result"]
    l.new(col_socket, bsdf.inputs["Color"])
    return mat


def mat_emit(name, color, strength):
    mat = bpy.data.materials.new(name)
    nt, n, l = _nodes(mat)
    out = n.new("ShaderNodeOutputMaterial")
    em = n.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    l.new(em.outputs[0], out.inputs["Surface"])
    return mat


def mat_export_emissive(name, color):
    """What the GLB carries for Emit_* meshes: black base, emissive colour, strength 1."""
    mat = bpy.data.materials.new(name)
    nt, n, l = _nodes(mat)
    out = n.new("ShaderNodeOutputMaterial")
    p = n.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
    p.inputs["Roughness"].default_value = 0.6
    p.inputs["Emission Color"].default_value = (*color, 1)
    p.inputs["Emission Strength"].default_value = 1.0
    l.new(p.outputs[0], out.inputs["Surface"])
    return mat


def build_materials():
    M = {}
    M["walnut"] = mat_surface("walnut", color=(0.21, 0.17, 0.15), tex="walnut_veneer_diff_2k.jpg",
                              size=1.8, gamma=1.35)
    M["felt"] = mat_surface("felt", color=(0.014, 0.012, 0.011))
    M["graphite"] = mat_surface("graphite", color=(0.022, 0.022, 0.024), noise=0.12,
                                noise_scale=(3, 3, 400))
    M["graphite_dark"] = mat_surface("graphite_dark", color=(0.011, 0.011, 0.012), noise=0.08)
    M["brass"] = mat_surface("brass", color=(0.46, 0.32, 0.12), noise=0.18, noise_scale=(2, 2, 300))
    M["plaster"] = mat_surface("plaster", color=(0.62, 0.56, 0.48), tex="beige_wall_001_diff_2k.jpg",
                               size=2.5, bump=0.15)
    M["ceiling"] = mat_surface("ceiling", color=(0.86, 0.84, 0.80), tex="beige_wall_001_diff_2k.jpg",
                               size=3.0, gamma=0.7)
    M["stone"] = mat_surface("stone", color=(0.44, 0.43, 0.42), tex="granite_tile_diff_2k.jpg",
                             size=2.3, bump=0.2)
    M["carpet"] = mat_surface("carpet", color=(0.2, 0.185, 0.175), tex="poly_wool_herringbone_diff_2k.jpg",
                              size=0.45, gamma=1.15, bump=0.6)
    M["blocker"] = mat_surface("blocker", color=(0.0, 0.0, 0.0))
    return M


# ---------------------------------------------------------------- geometry builder

class Atlas:
    """Collects faces in three.js coordinates with metric UV islands."""

    def __init__(self, name, mats):
        self.name = name
        self.mats = mats
        self.verts = []
        self.faces = []  # (vert indices, uvs, material name)

    def _v(self, p):
        self.verts.append(B(*p))
        return len(self.verts) - 1

    def rect(self, c, n, su, sv, mat):
        c, n = V(*c), V(*n).normalized()
        if abs(n.y) > 0.9:
            u = V(1, 0, 0)
        else:
            u = V(0, 1, 0).cross(n).normalized()
        v = n.cross(u)
        a, b = su / 2, sv / 2
        pts = [c - u * a - v * b, c + u * a - v * b, c + u * a + v * b, c - u * a + v * b]
        idx = [self._v(p) for p in pts]
        self.faces.append((idx, [(0, 0), (su, 0), (su, sv), (0, sv)], mat))

    def rect_minmax(self, axis, value, sign, lo, hi, mat):
        """Axis aligned rectangle on plane axis=value, facing sign; lo/hi are the other two
        coordinates in (x, y, z) order with the plane axis ignored."""
        c = [0, 0, 0]
        n = [0, 0, 0]
        n[axis] = sign
        c[axis] = value
        others = [i for i in range(3) if i != axis]
        size = {}
        for k, i in enumerate(others):
            c[i] = (lo[k] + hi[k]) / 2
            size[i] = hi[k] - lo[k]
        nv = V(*n)
        if abs(nv.y) > 0.9:
            su, sv = size[0], size[2]
        else:
            u = V(0, 1, 0).cross(nv)
            su = size[0] if abs(u.x) > 0.5 else size[2]
            sv = size[1]
        if su > 1e-6 and sv > 1e-6:
            self.rect(c, n, su, sv, mat)

    def box(self, mn, mx, mat, faces="xXyYzZ"):
        """Box with outward faces; faces picks which: x=-X, X=+X, y=-Y, Y=+Y, z=-Z, Z=+Z."""
        (x0, y0, z0), (x1, y1, z1) = mn, mx
        if "x" in faces:
            self.rect_minmax(0, x0, -1, (y0, z0), (y1, z1), mat)
        if "X" in faces:
            self.rect_minmax(0, x1, 1, (y0, z0), (y1, z1), mat)
        if "y" in faces:
            self.rect_minmax(1, y0, -1, (x0, z0), (x1, z1), mat)
        if "Y" in faces:
            self.rect_minmax(1, y1, 1, (x0, z0), (x1, z1), mat)
        if "z" in faces:
            self.rect_minmax(2, z0, -1, (x0, y0), (x1, y1), mat)
        if "Z" in faces:
            self.rect_minmax(2, z1, 1, (x0, y0), (x1, y1), mat)

    def strip(self, profile, y0, y1, mats):
        """Extrude a polyline of (x, z) points from y0 to y1 as one connected island.
        Normals follow (segment direction) x up, so walk +X along the back wall."""
        lo, hi = [], []
        for (x, z) in profile:
            lo.append(self._v((x, y0, z)))
            hi.append(self._v((x, y1, z)))
        u = 0.0
        for i in range(len(profile) - 1):
            (xa, za), (xb, zb) = profile[i], profile[i + 1]
            d = math.hypot(xb - xa, zb - za)
            self.faces.append(([lo[i], lo[i + 1], hi[i + 1], hi[i]],
                               [(u, 0), (u + d, 0), (u + d, y1 - y0), (u, y1 - y0)], mats[i]))
            u += d

    def disc(self, c, r, n_seg, y, mat, down=True):
        idx = []
        for k in range(n_seg):
            a = 2 * math.pi * k / n_seg * (1 if down else -1)
            idx.append(self._v((c[0] + r * math.cos(a), y, c[1] + r * math.sin(a))))
        uvs = [(r + r * math.cos(2 * math.pi * k / n_seg), r + r * math.sin(2 * math.pi * k / n_seg))
               for k in range(n_seg)]
        self.faces.append((idx, uvs, mat))

    def build(self, collection):
        me = bpy.data.meshes.new(self.name)
        bm = bmesh.new()
        bverts = [bm.verts.new(v) for v in self.verts]
        bm.verts.ensure_lookup_table()
        uv = bm.loops.layers.uv.new("UVMap")
        names = []
        for _, _, m in self.faces:
            if m not in names:
                names.append(m)
        for idx, uvs, m in self.faces:
            f = bm.faces.new([bverts[i] for i in idx])
            f.material_index = names.index(m)
            for loop, t in zip(f.loops, uvs):
                loop[uv].uv = t
        bm.to_mesh(me)
        bm.free()
        for m in names:
            me.materials.append(self.mats[m])
        obj = bpy.data.objects.new(self.name, me)
        collection.objects.link(obj)
        return obj


def slat_profile(xa, xb, z_back, z_front, slat=0.045, gap=0.02):
    """Back wall slats between xa and xb, starting and ending on backing. Returns chunks of
    (profile, mats) so each chunk unrolls into a near square island."""
    pitch = slat + gap
    n = int((xb - xa - gap) // pitch)
    margin = (xb - xa - (n * pitch + gap)) / 2
    chunks, per_chunk = [], 28
    for c0 in range(0, n, per_chunk):
        c1 = min(n, c0 + per_chunk)
        prof, mats = [], []
        x = xa + margin + c0 * pitch if c0 else xa
        prof.append((x, z_back))
        for k in range(c0, c1):
            sx = xa + margin + gap + k * pitch
            prof += [(sx, z_back), (sx, z_front), (sx + slat, z_front), (sx + slat, z_back)]
            mats += ["felt", "walnut", "walnut", "walnut"]
        if c1 == n:  # the last chunk runs on to the region edge; others stop at a slat edge
            prof.append((xb, z_back))
            mats.append("felt")
        # drop zero length segments at the ends
        clean_p, clean_m = [prof[0]], []
        for p, m in zip(prof[1:], mats):
            if math.hypot(p[0] - clean_p[-1][0], p[1] - clean_p[-1][1]) > 1e-6:
                clean_p.append(p)
                clean_m.append(m)
        chunks.append((clean_p, clean_m))
    return chunks


def build_room(M, col):
    A = {k: Atlas(k, M) for k in ATLASES}
    emit = {}

    def E(name):
        if name not in emit:
            emit[name] = Atlas(name, M)
        return emit[name]

    # ---- back wall (three z = -3.6): walnut slats on dark felt, screen recess, wash slot
    zb, zf = -3.63, -3.60
    rx0, rx1, ry0, ry1 = -1.65, 0.85, 0.97, 2.53  # screen recess (2.5 x 1.56)
    fw = 0.04  # recess frame width
    fx0, fx1, fy0, fy1 = rx0 - fw, rx1 + fw, ry0 - fw, ry1 + fw
    top = 3.32  # slats run up into the wall wash slot
    base = 0.08
    back = A["Room_Back"]
    for (xa, xb, ya, yb) in [(X0 - 0.02, fx0, base, top), (fx1, X1 + 0.02, base, top),
                             (fx0, fx1, base, fy0), (fx0, fx1, fy1, top)]:
        for prof, mats in slat_profile(xa, xb, zb, zf):
            back.strip(prof, ya, yb, mats)
    # recess: flat dark graphite panel, graphite frame with a brass inner reveal
    back.rect_minmax(2, -3.62, 1, (rx0, ry0), (rx1, ry1), "graphite_dark")
    for (mn, mx, faces) in [
        ((fx0, fy0, zb), (rx0, fy1, zf + 0.005), "xZ"),
        ((rx1, fy0, zb), (fx1, fy1, zf + 0.005), "XZ"),
        ((rx0, fy0, zb), (rx1, ry0, zf + 0.005), "yZ"),
        ((rx0, ry1, zb), (rx1, fy1, zf + 0.005), "YZ"),
    ]:
        back.box(mn, mx, "graphite", faces=faces)
    # brass reveal lining the opening (thin, inside the frame)
    t = 0.006
    back.box((rx0, ry0, -3.62), (rx0 + t, ry1, zf + 0.006), "brass", faces="XZ")
    back.box((rx1 - t, ry0, -3.62), (rx1, ry1, zf + 0.006), "brass", faces="xZ")
    back.box((rx0, ry0, -3.62), (rx1, ry0 + t, zf + 0.006), "brass", faces="YZ")
    back.box((rx0, ry1 - t, -3.62), (rx1, ry1, zf + 0.006), "brass", faces="yZ")

    # ---- floor: carpet over granite, baseboards
    fl = A["Room_Floor"]
    cx, cz, ch = 3.75, 2.3, 0.012
    fl.rect((0, ch, 0), (0, 1, 0), 2 * cx, 2 * cz, "carpet")
    fl.rect_minmax(0, -cx, -1, (0, -cz), (ch, cz), "carpet")
    fl.rect_minmax(0, cx, 1, (0, -cz), (ch, cz), "carpet")
    fl.rect_minmax(2, -cz, -1, (-cx, 0), (cx, ch), "carpet")
    fl.rect_minmax(2, cz, 1, (-cx, 0), (cx, ch), "carpet")
    fl.rect_minmax(1, 0, 1, (X0 - 0.06, Z0 - 0.04), (-cx, Z1 + 0.02), "stone")
    fl.rect_minmax(1, 0, 1, (cx, Z0 - 0.04), (X1 + 0.02, Z1 + 0.02), "stone")
    fl.rect_minmax(1, 0, 1, (-cx, Z0 - 0.04), (cx, -cz), "stone")
    fl.rect_minmax(1, 0, 1, (-cx, cz), (cx, Z1 + 0.02), "stone")
    bh = 0.08
    fl.box((X0 - 0.02, 0, zb), (X1 + 0.02, bh, -3.585), "graphite", faces="YZ")
    fl.box((X0 - 0.02, 0, 3.585), (X1 + 0.02, bh, Z1 + 0.02), "graphite", faces="Yz")
    door_z0, door_z1, door_h = 1.2, 2.2, 2.4
    for (za, zb2) in [(-3.585, door_z0), (door_z1, 3.585)]:
        fl.box((7.585, 0, za), (X1 + 0.02, bh, zb2), "graphite", faces="xY")

    # ---- walls atlas: front wall, right wall with door, window frame
    W = A["Room_Walls"]
    # front wall (three z = +3.6), plaster panels with shadow gap joints and a brass rail
    rail_y0, rail_y1 = 2.70, 2.735
    joints = [X0 + (X1 - X0) * k / 5 for k in range(1, 5)]
    jw = 0.016
    xs = [X0 - 0.02] + sum([[j - jw / 2, j + jw / 2] for j in joints], []) + [X1 + 0.02]
    for k in range(0, len(xs), 2):
        W.rect_minmax(2, Z1, -1, (xs[k], 0), (xs[k + 1], rail_y0), "plaster")
    for j in joints:  # recessed joint: back and two cheeks
        W.rect_minmax(2, Z1 + 0.012, -1, (j - jw / 2, 0), (j + jw / 2, rail_y0), "graphite_dark")
        W.rect_minmax(0, j - jw / 2, 1, (0, Z1), (rail_y0, Z1 + 0.012), "plaster")
        W.rect_minmax(0, j + jw / 2, -1, (0, Z1), (rail_y0, Z1 + 0.012), "plaster")
    W.rect_minmax(2, Z1, -1, (X0 - 0.02, rail_y1), (X1 + 0.02, H), "plaster")
    W.box((X0 - 0.02, rail_y0, Z1 - 0.018), (X1 + 0.02, rail_y1, Z1), "brass", faces="yYz")
    E("Emit_FrontLine").rect_minmax(1, rail_y0 - 0.001, -1, (X0, Z1 - 0.016), (X1, Z1 - 0.004), "felt")

    # right wall (three x = 7.6) with a walnut door
    W.rect_minmax(0, X1, -1, (0, Z0 - 0.02), (H, door_z0), "plaster")
    W.rect_minmax(0, X1, -1, (0, door_z1), (H, Z1 + 0.02), "plaster")
    W.rect_minmax(0, X1, -1, (door_h, door_z0), (H, door_z1), "plaster")
    dx = X1 + 0.03
    W.rect_minmax(0, dx, -1, (0, door_z0), (door_h, door_z1), "walnut")
    W.rect_minmax(2, door_z0, 1, (X1, 0), (dx, door_h), "brass")
    W.rect_minmax(2, door_z1, -1, (X1, 0), (dx, door_h), "brass")
    W.rect_minmax(1, door_h, -1, (X1, door_z0), (dx, door_z1), "brass")
    W.box((dx - 0.045, 0.85, door_z0 + 0.12), (dx - 0.025, 1.75, door_z0 + 0.14), "brass", faces="xzZyY")

    # window wall (three x = -5.25): graphite jambs, head, sill and mullions
    gx = X0  # glass plane
    md0, md1 = X0 - 0.06, X0 + 0.10
    head_y, sill_y = 3.1, 0.06
    W.box((md0, head_y, Z0 - 0.02), (md1, H + 0.02, Z1 + 0.02), "graphite", faces="Xy")
    W.box((md0, -0.01, Z0 - 0.02), (md1 + 0.02, sill_y, Z1 + 0.02), "graphite", faces="XY")
    W.box((md0, sill_y, Z0 - 0.02), (md1, head_y, Z0 + 0.07), "graphite", faces="XZ")
    W.box((md0, sill_y, Z1 - 0.07), (md1, head_y, Z1 + 0.02), "graphite", faces="Xz")
    bays = 5
    mullions = [Z0 + (Z1 - Z0) * k / bays for k in range(1, bays)]
    for mz in mullions:
        W.box((md0, sill_y, mz - 0.025), (md1, head_y, mz + 0.025), "graphite", faces="XzZ")

    # ---- ceiling: coffer with cove, wash slot, pendant
    C = A["Room_Ceiling"]
    ox, oz = 2.5, 1.1         # coffer opening half sizes
    rxh, rzh = 2.85, 1.45     # recess half sizes
    slot_z = -3.51
    cy, cyr, shelf, lip = H, 3.5, 3.22, 3.30
    C.rect_minmax(1, cy, -1, (X0 - 0.06, slot_z), (-ox, Z1 + 0.02), "ceiling")
    C.rect_minmax(1, cy, -1, (ox, slot_z), (X1 + 0.02, Z1 + 0.02), "ceiling")
    C.rect_minmax(1, cy, -1, (-ox, slot_z), (ox, -oz), "ceiling")
    C.rect_minmax(1, cy, -1, (-ox, oz), (ox, Z1 + 0.02), "ceiling")
    # wash slot along the back wall
    C.rect_minmax(1, top, -1, (X0 - 0.02, zb), (X1 + 0.02, slot_z), "graphite_dark")
    C.rect_minmax(2, slot_z, -1, (X0 - 0.02, cy), (X1 + 0.02, top), "graphite_dark")
    E("Emit_WallWash").rect_minmax(1, top - 0.003, -1, (X0, slot_z - 0.035), (X1, slot_z - 0.01), "felt")
    # coffer: fascia lip, shelf, recess walls, recess ceiling
    t = 0.04
    C.rect_minmax(0, -ox, 1, (cy, -oz), (lip, oz), "ceiling")
    C.rect_minmax(0, ox, -1, (cy, -oz), (lip, oz), "ceiling")
    C.rect_minmax(2, -oz, 1, (-ox, cy), (ox, lip), "ceiling")
    C.rect_minmax(2, oz, -1, (-ox, cy), (ox, lip), "ceiling")
    for (mn, mx) in [((-ox - t, shelf, -oz - t), (-ox, lip, oz + t)), ((ox, shelf, -oz - t), (ox + t, lip, oz + t))]:
        C.box(mn, mx, "ceiling", faces="Y" + ("x" if mn[0] < 0 else "X"))
    for (mn, mx) in [((-ox, shelf, -oz - t), (ox, lip, -oz)), ((-ox, shelf, oz), (ox, lip, oz + t))]:
        C.box(mn, mx, "ceiling", faces="Y" + ("z" if mn[2] < 0 else "Z"))
    C.rect_minmax(1, shelf, 1, (-rxh, -rzh), (-ox - t, rzh), "ceiling")
    C.rect_minmax(1, shelf, 1, (ox + t, -rzh), (rxh, rzh), "ceiling")
    C.rect_minmax(1, shelf, 1, (-ox - t, -rzh), (ox + t, -oz - t), "ceiling")
    C.rect_minmax(1, shelf, 1, (-ox - t, oz + t), (ox + t, rzh), "ceiling")
    C.rect_minmax(0, -rxh, 1, (cy, -rzh), (cyr, rzh), "ceiling")
    C.rect_minmax(0, rxh, -1, (cy, -rzh), (cyr, rzh), "ceiling")
    C.rect_minmax(2, -rzh, 1, (-rxh, cy), (rxh, cyr), "ceiling")
    C.rect_minmax(2, rzh, -1, (-rxh, cy), (rxh, cyr), "ceiling")
    C.rect_minmax(1, cyr, -1, (-rxh, -rzh), (rxh, rzh), "ceiling")
    cove = E("Emit_Cove")
    w0, w1 = 0.07, 0.10
    for (lo, hi) in [((-ox - w1, -oz - w1), (-ox - w0, oz + w1)), ((ox + w0, -oz - w1), (ox + w1, oz + w1)),
                     ((-ox - w0, -oz - w1), (ox + w0, -oz - w0)), ((-ox - w0, oz + w0), (ox + w0, oz + w1))]:
        cove.rect_minmax(1, shelf + 0.004, 1, lo, hi, "felt")
    # linear pendant: graphite bar, brass end caps, glowing underside, two cables
    py, L2 = 2.45, 1.6
    C.box((-L2, py - 0.03, -0.04), (L2, py + 0.03, 0.04), "graphite", faces="yYzZ")
    C.box((-L2 - 0.014, py - 0.035, -0.045), (-L2, py + 0.035, 0.045), "brass")
    C.box((L2, py - 0.035, -0.045), (L2 + 0.014, py + 0.035, 0.045), "brass")
    for x in (-1.2, 1.2):
        C.box((x - 0.003, py + 0.03, -0.003), (x + 0.003, cyr, 0.003), "graphite_dark", faces="xXzZ")
        C.box((x - 0.04, cyr - 0.012, -0.04), (x + 0.04, cyr, 0.04), "brass", faces="xXyzZ")
    E("Emit_Pendant").rect_minmax(1, py - 0.031, -1, (-L2 + 0.01, -0.03), (L2 - 0.01, 0.03), "felt")
    # recessed downlights grazing the front wall
    dl = E("Emit_Downlights")
    downlights = [(x, 2.75) for x in (-3.6, -1.6, 0.4, 2.4, 4.4, 6.4)]
    for (x, z) in downlights:
        dl.disc((x, z), 0.045, 16, H - 0.002, "felt")

    objs = {k: a.build(col) for k, a in A.items()}
    emits = {k: a.build(col) for k, a in emit.items()}

    # Glass: one mesh, five panes between the mullions, facing into the room.
    g = Atlas("Glass", M)
    edges = [Z0 + 0.07] + sum([[mz - 0.025, mz + 0.025] for mz in mullions], []) + [Z1 - 0.07]
    for k in range(0, len(edges), 2):
        g.rect_minmax(0, gx, 1, (sill_y, edges[k]), (head_y, edges[k + 1]), "felt")
    glass = g.build(col)
    glass.data.name = "Glass"
    return objs, emits, glass, downlights


def build_blocker(M, col):
    """Black shell outside the room so no light can sneak through cracks. Not exported."""
    a = Atlas("Blocker", M)
    e = 0.5
    xa, xb, za, zb, ya, yb = X0 - 0.06, X1 + e, Z0 - e, Z1 + e, -e, H + e
    a.rect_minmax(1, ya, 1, (xa, za), (xb, zb), "blocker")
    a.rect_minmax(1, yb, -1, (xa, za), (xb, zb), "blocker")
    a.rect_minmax(2, za, 1, (xa, ya), (xb, yb), "blocker")
    a.rect_minmax(2, zb, -1, (xa, ya), (xb, yb), "blocker")
    a.rect_minmax(0, xb, -1, (ya, za), (yb, zb), "blocker")
    # window side: frame around the glazing opening
    a.rect_minmax(0, xa, 1, (ya, za), (0, zb), "blocker")
    a.rect_minmax(0, xa, 1, (H, za), (yb, zb), "blocker")
    a.rect_minmax(0, xa, 1, (0, za), (H, Z0), "blocker")
    a.rect_minmax(0, xa, 1, (0, Z1), (H, zb), "blocker")
    return a.build(col)


# ---------------------------------------------------------------- lights and world

def add_light(col, name, kind, loc, rot=(0, 0, 0), power=10, color=(1, 1, 1), **kw):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = power
    ld.color = color
    for k, v in kw.items():
        setattr(ld, k, v)
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    col.objects.link(ob)
    return ob


def build_lights(col, downlights):
    lights = []
    # Area lights point along their local -Z, Blender -Z is down: rotation (0,0,0).
    lights.append(add_light(col, "L_Pendant", "AREA", B(0, 2.405, 0), power=170, color=WARM,
                            shape="RECTANGLE", size=3.0, size_y=0.05, spread=math.radians(120)))
    lights.append(add_light(col, "L_WallWash", "AREA", B((X0 + X1) / 2, 3.29, -3.535), power=200,
                            color=AMBER, shape="RECTANGLE", size=X1 - X0 - 0.1, size_y=0.03,
                            spread=math.radians(50)))
    lights.append(add_light(col, "L_FrontLine", "AREA", B((X0 + X1) / 2, 2.69, 3.588), power=70,
                            color=AMBER, shape="RECTANGLE", size=X1 - X0 - 0.1, size_y=0.01,
                            spread=math.radians(40)))
    for i, (x, z) in enumerate(downlights):
        lights.append(add_light(col, f"L_Down{i}", "SPOT", B(x, H - 0.01, z), power=55, color=(1.0, 0.8, 0.6),
                                spot_size=math.radians(75), spot_blend=0.7, shadow_soft_size=0.03))
    # Soft fill from the coffer so the room reads in the game camera.
    lights.append(add_light(col, "L_CofferFill", "AREA", B(0, 3.45, 0), power=170, color=(1.0, 0.82, 0.62),
                            shape="RECTANGLE", size=5.4, size_y=2.6))
    # Portal over the glazing guides daylight samples through the window.
    portal = add_light(col, "L_WindowPortal", "AREA", B(X0 - 0.07, H / 2, 0),
                       rot=(0, math.radians(-90), 0), shape="RECTANGLE", size=H, size_y=Z1 - Z0)
    portal.data.cycles.is_portal = True
    lights.append(portal)
    return lights


def build_world(scene, camera_sky=False):
    world = bpy.data.worlds.new("World")
    scene.world = world
    nt, n, l = _nodes(world)
    out = n.new("ShaderNodeOutputWorld")
    coord = n.new("ShaderNodeTexCoord")
    mapping = n.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0, 0, WORLD_ROT_Z)
    l.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    env = n.new("ShaderNodeTexEnvironment")
    env.image = load_image(HDRI, "Linear Rec.709")
    l.new(mapping.outputs[0], env.inputs["Vector"])
    bg = n.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = WORLD_STRENGTH
    l.new(env.outputs[0], bg.inputs["Color"])
    if not camera_sky:
        l.new(bg.outputs[0], out.inputs["Surface"])
        return world
    # Preview only: camera rays see the tonemapped skyline JPEG the game uses.
    env2 = n.new("ShaderNodeTexEnvironment")
    env2.image = load_image(SKY_JPG, "sRGB")
    l.new(mapping.outputs[0], env2.inputs["Vector"])
    bg2 = n.new("ShaderNodeBackground")
    l.new(env2.outputs[0], bg2.inputs["Color"])
    lp = n.new("ShaderNodeLightPath")
    mix = n.new("ShaderNodeMixShader")
    l.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    l.new(bg.outputs[0], mix.inputs[1])
    l.new(bg2.outputs[0], mix.inputs[2])
    l.new(mix.outputs[0], out.inputs["Surface"])
    return world


# ---------------------------------------------------------------- props (bake occluders)

def import_prop(col, file, loc3, yaw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PROPS, file))
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(f"Prop_{file}", None)
    col.objects.link(root)
    root.location = B(*loc3)
    root.rotation_euler = (0, 0, yaw)
    for o in new:
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
        if o.parent is None:
            o.parent = root
    return root, new


def seats():
    side = TABLE["width"] / 2 + EDGE_GAP
    end = TABLE["length"] / 2 + EDGE_GAP
    xs = [1.5, 0.5, -0.5, -1.5]
    out = [((end, 0, 0), -math.pi / 2)]
    out += [((x, 0, side), math.pi) for x in xs]
    out += [((-end, 0, 0), math.pi / 2)]
    out += [((x, 0, -side), 0.0) for x in reversed(xs)]
    return out


def build_props(col):
    objs = []
    objs += import_prop(col, "conference-table.glb", (0, 0, 0), 0)[1]
    for (sx, sy, sz), yaw in seats():
        # Boardroom.ts chairPosition: seat + (0, 0, -0.08) rotated about Y by the seat yaw.
        ox = SEAT_OFFSET_Z * math.sin(yaw)
        oz = SEAT_OFFSET_Z * math.cos(yaw)
        objs += import_prop(col, "executive-chair.glb", (sx + ox, 0, sz + oz), yaw)[1]
    objs += import_prop(col, "credenza.glb", (0, 0, -3.15), 0)[1]
    objs += import_prop(col, "potted-plant.glb", (-4.6, 0, -2.9), 0)[1]
    objs += import_prop(col, "potted-plant.glb", (-4.6, 0, 2.9), 0)[1]
    return objs


# ---------------------------------------------------------------- uv packing

def pack_uvs(obj, res):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="CARDINAL",
                            scale=True, merge_overlap=False, margin_method="FRACTION",
                            margin=12.0 / res, shape_method="AABB")
    bpy.ops.object.mode_set(mode="OBJECT")
    # The packer leaves empty bands at the atlas edges; stretch the layout per axis to fill it.
    uv = obj.data.uv_layers.active.data
    a = np.empty(len(uv) * 2, np.float32)
    uv.foreach_get("uv", a)
    a = a.reshape(-1, 2)
    lo, hi = a.min(0), a.max(0)
    m = 6.0 / res
    a = m + (a - lo) / (hi - lo) * (1 - 2 * m)
    uv.foreach_set("uv", a.ravel())
    print(f"[room] {obj.name} uv fill before stretch {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f}")


# ---------------------------------------------------------------- baking

def bake_target(obj, image):
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get("BakeTarget")
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.name = "BakeTarget"
        node.image = image
        nt.nodes.active = node
        for nd in nt.nodes:
            nd.select = nd == node


def isolate_materials(obj):
    for slot in obj.material_slots:
        slot.material = slot.material.copy()
        slot.material.name = f"{obj.name}_{slot.material.name.split('.')[0]}"


def new_float_image(name, res):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    return img


def save_exr(img, path):
    img.filepath_raw = path
    img.file_format = "OPEN_EXR"
    img.save()


def bake(scene, obj, kind, res, samples, path, pass_filter=None, margin=16):
    img = new_float_image(os.path.basename(path), res)
    bake_target(obj, img)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.cycles.samples = samples
    kw = dict(type=kind, margin=margin, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES")
    if pass_filter:
        kw["pass_filter"] = pass_filter
    if kind == "NORMAL":
        kw["normal_space"] = "OBJECT"
    t = time.time()
    bpy.ops.object.bake(**kw)
    dt = time.time() - t
    save_exr(img, path)
    print(f"[room] baked {obj.name} {kind} {res}px {samples}spp in {dt:.1f}s")
    return dt


def pixels(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Linear Rec.709"
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def write_exr(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new("tmp_write", w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    full = np.ones((h, w, 4), np.float32)
    full[..., :arr.shape[2]] = arr[..., :min(4, arr.shape[2])]
    img.pixels.foreach_set(full.ravel())
    save_exr(img, path)
    bpy.data.images.remove(img)


def denoise(src, normal, dst, res):
    """OpenImageDenoise through a throwaway compositor scene."""
    sc = bpy.data.scenes.get("denoise") or bpy.data.scenes.new("denoise")
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    if sc.camera is None:
        cam = bpy.data.objects.new("denoise_cam", bpy.data.cameras.new("denoise_cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
    ng = bpy.data.node_groups.new("denoise", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    a = ng.nodes.new("CompositorNodeImage")
    a.image = bpy.data.images.load(src, check_existing=False)
    nrm = ng.nodes.new("CompositorNodeImage")
    nrm.image = bpy.data.images.load(normal, check_existing=False)
    dn = ng.nodes.new("CompositorNodeDenoise")
    dn.inputs["HDR"].default_value = True
    out = ng.nodes.new("NodeGroupOutput")
    ng.links.new(a.outputs[0], dn.inputs["Image"])
    ng.links.new(nrm.outputs[0], dn.inputs["Normal"])
    ng.links.new(dn.outputs[0], out.inputs[0])
    sc.compositing_node_group = ng
    sc.render.use_compositing = True
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.filepath = dst
    bpy.ops.render.render(write_still=True, scene=sc.name)
    bpy.data.images.remove(a.image)
    bpy.data.images.remove(nrm.image)
    bpy.data.node_groups.remove(ng)


def upsample(a, res):
    h = a.shape[0]
    if h == res:
        return a
    # bilinear with half texel alignment
    t = (np.arange(res) + 0.5) * h / res - 0.5
    i0 = np.clip(np.floor(t).astype(int), 0, h - 1)
    i1 = np.clip(i0 + 1, 0, h - 1)
    f = (t - np.floor(t)).astype(np.float32)
    rows = a[i0] * (1 - f)[:, None, None] + a[i1] * f[:, None, None]
    return rows[:, i0] * (1 - f)[None, :, None] + rows[:, i1] * f[None, :, None]


def shoulder(x, knee=0.62, top=0.93):
    """Identity below knee, smooth exponential roll off that never exceeds top."""
    span = top - knee
    over = np.maximum(x - knee, 0)
    return np.where(x <= knee, x, knee + span * (1 - np.exp(-over / span)))


def compose(name, light_res, color_res, quality, scene):
    irr = pixels(os.path.join(BAKE_DIR, f"{name}_light_dn.exr"))[..., :3]
    alb = pixels(os.path.join(BAKE_DIR, f"{name}_color.exr"))[..., :3]
    irr = upsample(np.maximum(irr, 0), color_res)
    lin = irr * alb * EXPOSURE
    out = shoulder(lin)
    lum = out @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mask = alb.sum(-1) > 0
    pct = np.percentile(lum[mask], [5, 50, 95, 99, 99.9])
    print(f"[room] {name} luminance p5 {pct[0]:.3f} p50 {pct[1]:.3f} p95 {pct[2]:.3f} "
          f"p99 {pct[3]:.3f} p99.9 {pct[4]:.3f}, linear max {lin.max():.2f}")
    img = bpy.data.images.new(f"{name}_lm", color_res, color_res, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    full = np.ones((color_res, color_res, 4), np.float32)
    full[..., :3] = out
    img.pixels.foreach_set(full.ravel())
    path = os.path.join(BAKE_DIR, f"{name}_lm.jpg")
    settings = scene.render.image_settings
    settings.file_format = "JPEG"
    settings.quality = quality
    settings.color_mode = "RGB"
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
    return path, [round(float(p), 3) for p in pct]


# ---------------------------------------------------------------- export materials

def unlit_material(name, image_path):
    mat = bpy.data.materials.new(name)
    nt, n, l = _nodes(mat)
    out = n.new("ShaderNodeOutputMaterial")
    bg = n.new("ShaderNodeBackground")
    tex = n.new("ShaderNodeTexImage")
    tex.image = load_image(image_path)
    tex.interpolation = "Linear"
    mat.use_backface_culling = True
    l.new(tex.outputs["Color"], bg.inputs["Color"])
    l.new(bg.outputs[0], out.inputs["Surface"])
    return mat


def preview_material(name, image_path):
    mat = bpy.data.materials.new(name)
    nt, n, l = _nodes(mat)
    out = n.new("ShaderNodeOutputMaterial")
    em = n.new("ShaderNodeEmission")
    tex = n.new("ShaderNodeTexImage")
    tex.image = load_image(image_path)
    l.new(tex.outputs["Color"], em.inputs["Color"])
    l.new(em.outputs[0], out.inputs["Surface"])
    return mat


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0


# ---------------------------------------------------------------- cameras and previews

def look_camera(scene, name, eye3, target3, fov_v, res=(1920, 1010)):
    cam = bpy.data.cameras.new(name)
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(fov_v)
    cam.clip_start = 0.05
    cam.clip_end = 60
    ob = bpy.data.objects.new(name, cam)
    scene.collection.objects.link(ob)
    eye, target = B(*eye3), B(*target3)
    ob.location = eye
    ob.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    return ob


def render(scene, cam, path, samples=128):
    scene.camera = cam
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True, scene=scene.name)
    print(f"[room] rendered {path} in {time.time() - t:.1f}s")


GAME_CAM = ((6.4, 3.0, 0.0), (0.0, 0.9, 0.0), 36)
CENTRE_CAM = ((1.4, 1.5, 0.0), (-5.25, 1.35, 0.0), 50)


# ---------------------------------------------------------------- main

def main():
    t_start = time.time()
    os.makedirs(BAKE_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    scene = reset()
    col = scene.collection
    M = build_materials()
    objs, emits, glass, downlights = build_room(M, col)
    blocker = build_blocker(M, col)
    lights = build_lights(col, downlights)
    props = build_props(col)

    # Bake time emission for the light lines (they light the room in Cycles).
    emit_bake = {
        "Emit_Pendant": mat_emit("bake_pendant", WARM, 6.0),
        "Emit_Cove": mat_emit("bake_cove", AMBER, 14.0),
        "Emit_WallWash": mat_emit("bake_wash", AMBER, 8.0),
        "Emit_FrontLine": mat_emit("bake_front", AMBER, 8.0),
        "Emit_Downlights": mat_emit("bake_down", (1.0, 0.85, 0.7), 12.0),
    }
    for k, ob in emits.items():
        set_material(ob, emit_bake[k])
    glass.hide_render = True

    if PREVIEW_ONLY:
        build_world(scene, camera_sky=True)
        cam = look_camera(scene, "GameCam", *GAME_CAM)
        render(scene, cam, os.path.join(PREVIEW_DIR or BAKE_DIR, "lighting-look.jpg"), samples=96)
        cam2 = look_camera(scene, "CentreCam", *CENTRE_CAM)
        render(scene, cam2, os.path.join(PREVIEW_DIR or BAKE_DIR, "lighting-look-window.jpg"), samples=96)
        return

    build_world(scene)
    for name, ob in objs.items():
        pack_uvs(ob, ATLASES[name][0])
        isolate_materials(ob)

    bake_seconds = 0.0
    if not REUSE:
        for name, ob in objs.items():
            color_res, light_res, _ = ATLASES[name]
            p = lambda s: os.path.join(BAKE_DIR, f"{name}_{s}.exr")
            bake_seconds += bake(scene, ob, "NORMAL", light_res, 4, p("normal"))
            raw = pixels(p("normal"))
            raw[..., :3] = raw[..., :3] * 2 - 1
            write_exr(raw, p("normal"))
            bake_seconds += bake(scene, ob, "DIFFUSE", light_res, SAMPLES, p("light"),
                                 pass_filter={"DIRECT", "INDIRECT"})
            t = time.time()
            denoise(p("light"), p("normal"), p("light_dn"), light_res)
            print(f"[room] denoised {name} in {time.time() - t:.1f}s")
            bake_seconds += bake(scene, ob, "DIFFUSE", color_res, 16, p("color"), pass_filter={"COLOR"})

    stats = {}
    images = {}
    for name in objs:
        color_res, light_res, q = ATLASES[name]
        images[name], stats[name] = compose(name, light_res, color_res, q, scene)

    # ---- export: unlit atlases, Glass, Emit_* only
    for name, ob in objs.items():
        set_material(ob, unlit_material(f"{name}_unlit", images[name]))
    glass_mat = bpy.data.materials.new("Glass")
    glass_mat.use_nodes = True
    pb = next(nd for nd in glass_mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
    pb.inputs["Base Color"].default_value = (0.6, 0.66, 0.7, 1)
    pb.inputs["Alpha"].default_value = 0.15
    pb.inputs["Roughness"].default_value = 0.05
    set_material(glass, glass_mat)
    emit_colors = {
        "Emit_Pendant": WARM, "Emit_Cove": AMBER, "Emit_WallWash": AMBER,
        "Emit_FrontLine": AMBER, "Emit_Downlights": (1.0, 0.85, 0.7),
    }
    for k, ob in emits.items():
        set_material(ob, mat_export_emissive(f"{k}_mat", emit_colors[k]))
    export = list(objs.values()) + list(emits.values()) + [glass]
    bpy.ops.object.select_all(action="DESELECT")
    for ob in export:
        ob.select_set(True)
    glb = os.path.join(OUT_DIR, "room.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False,
                              export_image_format="AUTO", export_materials="EXPORT",
                              export_normals=True, export_tangents=False, export_animations=False,
                              export_extras=False)
    size = os.path.getsize(glb)
    print(f"[room] wrote {glb} ({size / 1e6:.2f} MB)")

    manifest = {
        "generated": time.strftime("%Y-%m-%d"),
        "file": "room.glb",
        "bytes": size,
        "builder": "game-ui/tools/build_room.py (Blender 5.2, Cycles Metal bake)",
        "coordinates": "three.js metres, +Y up; interior x -5.25..7.6, z -3.6..3.6, floor y 0, ceiling y 3.2 "
                       "(coffer recess rises to y 3.5 above the table)",
        "meshes": {
            "baked_unlit": list(objs.keys()),
            "glass": "Glass",
            "emissive": sorted(emits.keys()),
        },
        "materials": {
            "baked_unlit": "KHR_materials_unlit, baseColorTexture is the full baked radiance (sRGB JPEG)",
            "emissive": "black base colour, emissiveFactor holds the light colour at strength 1; boost "
                        "emissiveIntensity for bloom",
            "glass": "placeholder material, intended to be overridden",
        },
        "bake": {
            "atlases": {k: {"color_px": v[0], "lighting_px": v[1], "jpeg_quality": v[2],
                            "luminance_p5_p50_p95_p99_p999": stats[k]} for k, v in ATLASES.items()},
            "samples": SAMPLES,
            "seconds": round(bake_seconds, 1),
            "denoiser": "OpenImageDenoise (compositor) on the lighting bake, with baked normals",
            "tone": "linear below 0.62, exponential shoulder capped at 0.93, before sRGB encoding",
            "exposure": EXPOSURE,
        },
        "sky": {
            "file": "textures/sky/skyline.jpg",
            "source": "Poly Haven sunset_jhbcentral (CC0), tonemapped JPG downscaled to 4096x2048",
            "u_facing_minus_x": SKY_U_WEST,
            "blender_world_rotation_z_deg": round(math.degrees(WORLD_ROT_Z), 2),
            "blender_world_strength": WORLD_STRENGTH,
            "three_background_rotation_y_rad_suggested": round(math.radians(360 * (SKY_U_WEST - 0.5) + 180), 4),
            "note": "three.js equirect lookup: u = atan2(dir.z, dir.x)/(2 pi) + 0.5, so -X samples u = 0 by "
                    "default; scene.backgroundRotation.y = pi + 2 pi (u - 0.5) brings u onto -X "
                    "(derived from the shader maths; check visually).",
        },
        "exposure_notes": [
            "Render the room meshes with MeshBasicMaterial (map, sRGB colour space). Values are at or below "
            "about 0.93 and mostly below 0.6, so NeutralToneMapping at exposure 1.0 leaves them almost "
            "unchanged; toneMapped false is also fine.",
            "Realtime lights only need to light characters and props; the room ignores them.",
            "Daylight is a cool overcast twilight from the window side; warm 2700K pendant, amber cove, "
            "amber wall wash on the slats and amber line under the front wall brass rail.",
        ],
        "keep_clear": {
            "screen_recess": {"center": [-0.4, 1.75, -3.62], "size": [2.5, 1.56],
                              "note": "flat dark graphite panel at z -3.62; slat fronts are at z -3.60"},
            "clock": [2.0, 1.95, -3.6],
            "credenza": [0, 0, -3.15],
            "plants": [[-4.6, 0, -2.9], [-4.6, 0, 2.9]],
            "door": {"wall": "x 7.6", "z": [1.2, 2.2], "height": 2.4},
        },
        "sources": {
            "hdri": "https://polyhaven.com/a/sunset_jhbcentral (CC0)",
            "textures": [
                "https://polyhaven.com/a/walnut_veneer (CC0)",
                "https://polyhaven.com/a/poly_wool_herringbone (CC0)",
                "https://polyhaven.com/a/granite_tile (CC0)",
                "https://polyhaven.com/a/beige_wall_001 (CC0)",
            ],
            "procedural": "graphite and brushed brass are procedural noise materials",
        },
    }
    with open(os.path.join(OUT_DIR, "room.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    if PREVIEW_DIR:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        build_world(scene, camera_sky=True)
        for name, ob in objs.items():
            set_material(ob, preview_material(f"{name}_preview", images[name]))
        preview_emit = {k: mat_emit(f"prev_{k}", emit_colors[k], 1.6) for k in emits}
        for k, ob in emits.items():
            set_material(ob, preview_emit[k])
        blocker.hide_render = True
        glass.hide_render = True
        cam = look_camera(scene, "GameCam", *GAME_CAM)
        render(scene, cam, os.path.join(PREVIEW_DIR, "room-preview.jpg"))
        cam2 = look_camera(scene, "CentreCam", *CENTRE_CAM)
        render(scene, cam2, os.path.join(PREVIEW_DIR, "room-window.jpg"))
    print(f"[room] done in {time.time() - t_start:.0f}s, bake {bake_seconds:.0f}s")


main()
