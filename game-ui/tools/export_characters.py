"""Export Mixamo-rigged characters and a shared seated animation library for the browser.

Run with Blender in background mode from the repository root:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python game-ui/tools/export_characters.py -- \
        assets/characters/mixamo_rigged game-ui/public/models/characters 01 02 03

Each character becomes <name>.glb with mesh, skin and a 1024 px texture, without animation.
The first character's rig also produces animations.glb, holding one clip per seated
animation. All characters share the Mixamo skeleton, so the browser reuses those clips.
"""
import glob
import json
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
WANTED = argv[2:]
TEXTURE_SIZE = 1024
CLIPS = {
    "talk": "Sitting Talking.fbx",
    "disbelief": "Sitting Disbelief.fbx",
    "typing": "Typing.fbx",
}
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_character(path):
    reset()
    bpy.ops.import_scene.fbx(filepath=path)
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    if rig.animation_data:
        rig.animation_data.action = None
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    return rig


def shrink_textures():
    for image in bpy.data.images:
        if image.size[0] > TEXTURE_SIZE:
            image.scale(TEXTURE_SIZE, TEXTURE_SIZE)


def action_curves(action):
    if hasattr(action, "fcurves") and len(action.fcurves):
        return list(action.fcurves)
    return [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def import_clip(rig, path, name):
    """Import a skinless Mixamo animation and retarget it onto rig by bone name."""
    prefix = rig.data.bones[0].name.split(":")[0] + ":"
    targets = {b.name for b in rig.data.bones}
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    source = next(o for o in imported if o.type == "ARMATURE")
    action = source.animation_data.action
    action.name = name
    # Mixamo animation files use a 0.01-scaled armature in centimetres and a shorter rig.
    # Location keys are bone-local offsets, so convert them to the target rig's units and
    # proportions: world offset = key * source scale, scaled by the hips height ratio.
    def hips_height(rig_obj):
        bone = next(b for b in rig_obj.data.bones if b.name.split(":")[-1] == "Hips")
        return (rig_obj.matrix_world @ bone.head_local).z
    factor = (source.matrix_world.to_scale().x / rig.matrix_world.to_scale().x) * hips_height(rig) / hips_height(source)
    for fc in action_curves(action):
        if 'pose.bones["' in fc.data_path:
            bone = fc.data_path.split('pose.bones["')[1].split('"]')[0]
            target = prefix + bone.split(":")[-1]
            if target in targets:
                fc.data_path = fc.data_path.replace(bone, target)
            if fc.data_path.endswith(".location"):
                for point in fc.keyframe_points:
                    point.co.y *= factor
                    point.handle_left.y *= factor
                    point.handle_right.y *= factor
    print("CLIP", name, "location factor", round(factor, 5), flush=True)
    for obj in imported:
        bpy.data.objects.remove(obj)
    return action


def add_track(rig, action, name):
    rig.animation_data_create()
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    start = int(action.frame_range[0])
    strip = track.strips.new(name, start, action)
    if hasattr(strip, "action_slot") and action.slots:
        strip.action_slot = action.slots[0]
    track.mute = False
    return track


def export(path, animations):
    kwargs = dict(filepath=path, export_format="GLB", export_yup=True, export_skins=True,
                  export_animations=animations, export_image_format="JPEG", export_jpeg_quality=85)
    if animations:
        kwargs.update(export_animation_mode="NLA_TRACKS", export_frame_step=2,
                      export_force_sampling=True, export_optimize_animation_size=True)
    bpy.ops.export_scene.gltf(**kwargs)


paths = sorted(glob.glob(os.path.join(SRC, "[0-9][0-9]-*.fbx")))
if WANTED:
    paths = [p for p in paths if os.path.basename(p)[:2] in WANTED]
manifest = []
for index, path in enumerate(paths):
    name = os.path.basename(path)[:-4]
    rig = load_character(path)
    shrink_textures()
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    out = os.path.join(OUT, name + ".glb")
    export(out, animations=False)
    manifest.append({"id": name, "file": f"characters/{name}.glb", "triangles": sum(len(p.vertices) - 2 for p in mesh.data.polygons),
                     "bytes": os.path.getsize(out)})
    print("EXPORTED", name, os.path.getsize(out), flush=True)

    if index == 0:
        # Shared animation library on this rig. A one-frame "sit" pose comes from the talk clip.
        talk = None
        for clip, filename in CLIPS.items():
            action = import_clip(rig, os.path.join(SRC, filename), clip)
            add_track(rig, action, clip)
            if clip == "talk":
                talk = action
        sit = talk.copy()
        sit.name = "sit"
        first = talk.frame_range[0]
        for fc in action_curves(sit):
            value = fc.evaluate(first)
            for point in list(fc.keyframe_points)[::-1]:
                fc.keyframe_points.remove(point)
            fc.keyframe_points.insert(first, value)
            fc.keyframe_points.insert(first + 1, value)
        add_track(rig, sit, "sit")
        bpy.data.objects.remove(mesh)
        anim_out = os.path.join(OUT, "animations.glb")
        export(anim_out, animations=True)
        print("EXPORTED animations", os.path.getsize(anim_out), flush=True)

with open(os.path.join(OUT, "characters.json"), "w") as handle:
    json.dump(manifest, handle, indent=1)
print("DONE", len(manifest), flush=True)
