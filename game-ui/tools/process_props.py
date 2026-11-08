"""Turn Tripo prop exports into web ready GLBs for the boardroom.

Run with Blender in background mode from the repository root:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python game-ui/tools/process_props.py -- \
        assets/props/advanced-2026-11-07/tripo-new game-ui/public/models/props

For each entry in PROPS the script imports the source GLB, optionally turns it about the
vertical axis, scales it (uniformly to a target size, or exactly per axis), puts its base on
the floor and centres it, reduces the triangle count, downsizes the texture and exports a GLB
with JPEG textures. Props face +Z in three.js (Blender -Y), like the characters. It also
writes props.json describing every model.
"""
import json
import math
import os
import sys
from datetime import date

import bpy
from mathutils import Vector

SRC, OUT = sys.argv[sys.argv.index("--") + 1:][:2]

# Sizes are three.js metres: w along X, d along Z, h along Y.
# mode "fit" scales uniformly so the named axis matches; "exact" scales each axis.
PROPS = [
    dict(id="command-table", src="modern conference table 3d model.glb", turn=90, mode="exact", size=dict(w=4.2, d=1.4, h=0.76), tris=12000, tex=2048, description="Walnut command table with lit glass channel, seats 10"),
    dict(id="executive-chair", src="luxury office chair 3d model.glb", mode="fit", axis="h", size=dict(h=1.15), tris=10000, tex=2048, description="Quilted leather executive chair, reused at every seat"),
    dict(id="frameless-display", src="gold framed monitor 3d model.glb", mode="fit", axis="w", size=dict(w=2.2), tris=6000, tex=1024, description="Brass framed wall display; the live screen is drawn on its face"),
    dict(id="holo-hub", src="round wireless charging pad 3d model.glb", mode="fit", axis="w", size=dict(w=0.5), tris=8000, tex=1024, description="Holographic briefing projector base for the table centre"),
    dict(id="credenza", src="modern wooden sideboard 3d model.glb", mode="fit", axis="w", size=dict(w=2.2), tris=10000, tex=2048, description="Fluted walnut credenza under the wall display"),
    dict(id="voting-console", src="wooden touchscreen display 3d model.glb", mode="fit", axis="w", size=dict(w=0.2), tris=6000, tex=1024, description="Per seat voting console"),
    dict(id="laptop", src="laptop 3d model.glb", mode="fit", axis="w", size=dict(w=0.34), tris=8000, tex=1024, description="Graphite laptop at every seat"),
    dict(id="crisis-clock", src="modern circular clock 3d model.glb", mode="fit", axis="w", size=dict(w=0.5), tris=6000, tex=1024, description="Smoked glass wall clock"),
    dict(id="sculptural-plant", src="potted olive tree 3d model.glb", mode="fit", axis="h", size=dict(h=1.8), tris=26000, tex=2048, description="Olive tree in a ribbed planter"),
    dict(id="water-service", src="decanter with glasses 3d model.glb", mode="fit", axis="w", size=dict(w=0.5), tris=10000, tex=1024, description="Carafe and tumblers on a walnut tray"),
]
AXIS = {"w": 0, "d": 1, "h": 2}  # Blender x, y (depth), z (height)


def bounds(objects):
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return lo, hi


def triangles(objects):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects)


manifest = []
os.makedirs(OUT, exist_ok=True)
for spec in PROPS:
    path = os.path.join(SRC, spec["src"])
    if not os.path.exists(path):
        print("MISSING", spec["id"], flush=True)
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if spec.get("turn"):
        obj.rotation_euler.z = math.radians(spec["turn"])
        bpy.ops.object.transform_apply(rotation=True)

    lo, hi = bounds([obj])
    dims = hi - lo
    if spec["mode"] == "exact":
        s = spec["size"]
        obj.scale = (s["w"] / dims.x, s["d"] / dims.y, s["h"] / dims.z)
    else:
        k = spec["size"][spec["axis"]] / dims[AXIS[spec["axis"]]]
        obj.scale = (k, k, k)
    bpy.ops.object.transform_apply(scale=True)
    lo, hi = bounds([obj])
    obj.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    bpy.ops.object.transform_apply(location=True)

    before = triangles([obj])
    if before > spec["tris"]:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = spec["tris"] / before
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    after = triangles([obj])

    for image in bpy.data.images:
        if image.size[0] > spec["tex"]:
            image.scale(spec["tex"], spec["tex"])

    out = os.path.join(OUT, spec["id"] + ".glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, use_selection=False,
                              export_image_format="JPEG", export_jpeg_quality=86, export_animations=False)
    lo, hi = bounds([obj])
    actual = hi - lo
    manifest.append(dict(
        id=spec["id"], file=spec["id"] + ".glb", description=spec["description"],
        target_size_m=spec["size"], actual_size_m=dict(w=round(actual.x, 3), d=round(actual.y, 3), h=round(actual.z, 3)),
        triangles=after, source_triangles=before, texture_px=spec["tex"], bytes=os.path.getsize(out),
        source=os.path.join("assets/props/advanced-2026-11-07/tripo-new", spec["src"]),
    ))
    print("EXPORTED", spec["id"], before, "->", after, "tris", os.path.getsize(out), "bytes", [round(v, 3) for v in actual], flush=True)

with open(os.path.join(OUT, "props.json"), "w") as handle:
    json.dump(dict(
        generated=str(date.today()),
        pipeline="Nano Banana 2.1 concept image -> Tripo 3D -> Blender (game-ui/tools/process_props.py): scale, floor, decimate, JPEG textures",
        conventions=dict(units="metres", up="+Y (glTF)", front="+Z (glTF)", origin="centred in X/Z, base at Y=0", w_d_h="W along X, D along Z, H along Y"),
        models=manifest,
    ), handle, indent=1)
print("DONE", len(manifest), flush=True)
