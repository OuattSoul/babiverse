"""Inspection des modèles 3D glTF 2.0 (GLB binaire, ou glTF JSON autonome) importés dans la médiathèque.

L'atelier ne dessine pas les modèles : il vérifie qu'ils pourront être chargés par le jeu (Three.js, `GLTFLoader`
sans décodeur Draco ni Meshopt) et en extrait ce dont l'éditeur de cartes a besoin :
- dimensions (boîte englobante de la scène, en unités du modèle : 1 unité = 1 case de jeu à l'échelle 1) ;
- objets nommés porteurs d'un maillage, avec leur boîte, pour créer une zone interactive « depuis l'objet » ;
- nombre de triangles, matériaux, textures, avertissements (noms absents ou en double, modèle lourd).

Un glTF JSON n'est accepté que s'il est autonome (tampons et images en `data:`) : un fichier externe manquant
casserait le chargement dans le jeu. Un nom d'objet n'est jamais pris pour un identifiant fiable : les doublons
sont signalés et l'éditeur ne propose que les noms uniques.
"""
from __future__ import annotations

import base64
import json
import math
import struct

GLB_MAGIC = b"glTF"
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
# Extensions que le chargeur du jeu ne sait pas décoder (aucun décodeur embarqué).
UNSUPPORTED = {"KHR_draco_mesh_compression": "Draco", "EXT_meshopt_compression": "Meshopt", "KHR_mesh_quantization": "quantification"}
HEAVY_TRIANGLES = 150_000
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class GltfError(ValueError):
    pass


def _parse_glb(data: bytes) -> tuple[dict, int]:
    if len(data) < 20:
        raise GltfError("GLB tronqué.")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != GLB_MAGIC:
        raise GltfError("Ce n'est pas un fichier GLB.")
    if version != 2:
        raise GltfError(f"GLB version {version} non prise en charge (glTF 2.0 attendu).")
    if length != len(data):
        raise GltfError("GLB tronqué ou corrompu (taille annoncée différente de la taille réelle).")
    offset, doc, bin_len = 12, None, 0
    while offset + 8 <= len(data):
        clen, ctype = struct.unpack_from("<II", data, offset)
        body = data[offset + 8: offset + 8 + clen]
        if len(body) != clen:
            raise GltfError("GLB corrompu (bloc tronqué).")
        if ctype == CHUNK_JSON and doc is None:
            try:
                doc = json.loads(body.decode("utf-8").rstrip(" \x00"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise GltfError("GLB corrompu (description JSON illisible).") from exc
        elif ctype == CHUNK_BIN:
            bin_len = clen
        offset += 8 + clen
    if not isinstance(doc, dict):
        raise GltfError("GLB sans description JSON.")
    return doc, bin_len


def _parse_gltf(data: bytes) -> dict:
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise GltfError("glTF illisible (JSON invalide).") from exc
    if not isinstance(doc, dict):
        raise GltfError("glTF illisible.")
    for kind in ("buffers", "images"):
        for i, item in enumerate(doc.get(kind) or []):
            uri = item.get("uri")
            if uri is None and kind == "images":
                continue  # image dans un bufferView
            if not isinstance(uri, str) or not uri.startswith("data:"):
                raise GltfError(f"Fichier externe manquant : « {uri or kind + str(i)} ». Importer un GLB, ou un glTF dont "
                                "les tampons et textures sont intégrés (data:).")
            if kind == "buffers" and ";base64," in uri:
                try:
                    base64.b64decode(uri.split(",", 1)[1], validate=True)
                except ValueError as exc:
                    raise GltfError(f"Tampon {i} illisible (base64 invalide).") from exc
    return doc


def _matrix(node: dict) -> list[float]:
    """Matrice locale 4×4 (colonnes, comme glTF) d'un nœud : `matrix` ou translation × rotation × échelle."""
    if isinstance(node.get("matrix"), list) and len(node["matrix"]) == 16:
        return [float(v) for v in node["matrix"]]
    tx, ty, tz = (node.get("translation") or [0, 0, 0])[:3]
    qx, qy, qz, qw = (node.get("rotation") or [0, 0, 0, 1])[:4]
    sx, sy, sz = (node.get("scale") or [1, 1, 1])[:3]
    xx, yy, zz, xy, xz, yz, wx, wy, wz = qx * qx, qy * qy, qz * qz, qx * qy, qx * qz, qy * qz, qw * qx, qw * qy, qw * qz
    return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
            2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
            2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
            tx, ty, tz, 1]


def _mul(a: list[float], b: list[float]) -> list[float]:
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def _apply(m: list[float], p) -> tuple[float, float, float]:
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])


def _merge(box, other):
    if box is None:
        return other
    if other is None:
        return box
    return [min(box[0], other[0]), min(box[1], other[1]), min(box[2], other[2]),
            max(box[3], other[3]), max(box[4], other[4]), max(box[5], other[5])]


def _mesh_box(doc: dict, mesh_index: int, m: list[float]):
    """Boîte (repère de la scène) d'un maillage, d'après min/max des positions (obligatoires en glTF 2.0)."""
    box = None
    accessors = doc.get("accessors") or []
    for prim in (doc.get("meshes") or [])[mesh_index].get("primitives") or []:
        idx = (prim.get("attributes") or {}).get("POSITION")
        if not isinstance(idx, int) or idx >= len(accessors):
            continue
        acc = accessors[idx]
        lo, hi = acc.get("min"), acc.get("max")
        if not (isinstance(lo, list) and isinstance(hi, list) and len(lo) >= 3 and len(hi) >= 3):
            continue
        for corner in ((x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])):
            p = _apply(m, corner)
            box = _merge(box, [*p, *p])
    return box


def _triangles(doc: dict) -> int:
    accessors = doc.get("accessors") or []
    total = 0
    for mesh in doc.get("meshes") or []:
        for prim in mesh.get("primitives") or []:
            if prim.get("mode", 4) != 4:
                continue
            idx = prim.get("indices")
            if not isinstance(idx, int):
                idx = (prim.get("attributes") or {}).get("POSITION")
            if isinstance(idx, int) and idx < len(accessors):
                total += int(accessors[idx].get("count", 0)) // 3
    return total


def _rounded(box):
    return None if box is None else [round(v, 4) for v in box]


def inspect(data: bytes) -> dict:
    """Retourne {mime, ext, meta} d'un modèle valide ; lève GltfError sinon."""
    binary = data[:4] == GLB_MAGIC
    doc, bin_len = _parse_glb(data) if binary else (_parse_gltf(data), 0)
    asset = doc.get("asset") or {}
    if not str(asset.get("version", "")).startswith("2"):
        raise GltfError("glTF 2.0 attendu (champ asset.version).")
    blocked = [UNSUPPORTED[e] for e in doc.get("extensionsRequired") or [] if e in UNSUPPORTED]
    if blocked:
        raise GltfError(f"Compression non prise en charge par le jeu : {', '.join(blocked)}. Exporter sans compression.")
    nodes = doc.get("nodes") or []
    if not doc.get("meshes"):
        raise GltfError("Le modèle ne contient aucun maillage.")
    scenes = doc.get("scenes") or [{"nodes": list(range(len(nodes)))}]
    scene = scenes[doc.get("scene", 0) if isinstance(doc.get("scene"), int) and doc["scene"] < len(scenes) else 0]

    objects: list[dict] = []
    total = None
    seen: set[int] = set()
    identity = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]

    def walk(i: int, parent: list[float], depth: int):
        """Boîte du sous-arbre du nœud `i` (son maillage et ceux de ses enfants), dans le repère de la scène."""
        if not isinstance(i, int) or i >= len(nodes) or i in seen or depth > 64:
            return None
        seen.add(i)
        node = nodes[i]
        m = _mul(parent, _matrix(node))
        mesh = node.get("mesh")
        box = _mesh_box(doc, mesh, m) if isinstance(mesh, int) and mesh < len(doc["meshes"]) else None
        for c in node.get("children") or []:
            box = _merge(box, walk(c, m, depth + 1))
        name = node.get("name")
        if box is not None and isinstance(name, str) and name.strip():
            objects.append({"name": name.strip()[:80], "node": i, "box": _rounded(box)})
        return box

    for root in scene.get("nodes") or []:
        total = _merge(total, walk(root, identity, 0))
    if total is None:
        raise GltfError("Dimensions introuvables (positions sans min/max).")

    counts: dict[str, int] = {}
    for o in objects:
        counts[o["name"]] = counts.get(o["name"], 0) + 1
    for o in objects:
        o["unique"] = counts[o["name"]] == 1
    warnings = []
    if not objects:
        warnings.append("Aucun objet nommé : les zones interactives devront être tracées à la main.")
    dupes = sorted(n for n, c in counts.items() if c > 1)
    if dupes:
        warnings.append(f"Noms d'objets en double (non utilisables pour cibler un objet) : {', '.join(dupes[:10])}.")
    tris = _triangles(doc)
    if tris > HEAVY_TRIANGLES:
        warnings.append(f"Modèle lourd : {tris:,} triangles (au-delà de {HEAVY_TRIANGLES:,}, risque de lenteur sur téléphone).".replace(",", " "))
    box = _rounded(total)
    size = [round(box[3] - box[0], 3), round(box[4] - box[1], 3), round(box[5] - box[2], 3)]
    if max(size) <= 0 or not all(math.isfinite(v) for v in box):
        raise GltfError("Dimensions du modèle invalides.")
    meta = {
        "format": "glb" if binary else "gltf", "generator": str(asset.get("generator", ""))[:120],
        "bbox": box, "size": size, "triangles": tris,
        "meshes": len(doc.get("meshes") or []), "materials": len(doc.get("materials") or []),
        "textures": len(doc.get("textures") or []), "images": len(doc.get("images") or []),
        "binary_bytes": bin_len, "objects": objects[:200], "warnings": warnings,
        "extensions": sorted(doc.get("extensionsUsed") or [])[:20],
    }
    return {"mime": "model/gltf-binary" if binary else "model/gltf+json", "ext": "glb" if binary else "gltf", "meta": meta}


def build_box_glb(parts: list[tuple[str, tuple[float, float, float], tuple[float, float, float]]]) -> bytes:
    """GLB minimal fait de pavés nommés (nom, centre, taille) : fixtures de tests et démonstration."""
    positions, indices, nodes, meshes, accessors, views = bytearray(), bytearray(), [], [], [], []
    for i, (name, (cx, cy, cz), (sx, sy, sz)) in enumerate(parts):
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        verts = [(x, y, z) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)]
        tri = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3]
        p_off, i_off = len(positions), len(indices)
        for v in verts:
            positions += struct.pack("<3f", *v)
        for t in tri:
            indices += struct.pack("<H", t)
        views.append({"buffer": 0, "byteOffset": p_off, "byteLength": 96})
        views.append({"buffer": 0, "byteOffset": i_off, "byteLength": 72})
        accessors.append({"bufferView": 2 * i, "componentType": 5126, "count": 8, "type": "VEC3",
                          "min": [-hx, -hy, -hz], "max": [hx, hy, hz]})
        accessors.append({"bufferView": 2 * i + 1, "componentType": 5123, "count": 36, "type": "SCALAR"})
        meshes.append({"primitives": [{"attributes": {"POSITION": 2 * i}, "indices": 2 * i + 1, "material": 0}]})
        nodes.append({"name": name, "mesh": i, "translation": [cx, cy, cz]})
    # positions puis indices dans un seul tampon : on décale les vues d'indices
    for v in views[1::2]:
        v["byteOffset"] += len(positions)
    blob = bytes(positions + indices)
    blob += b"\x00" * (-len(blob) % 4)
    doc = {"asset": {"version": "2.0", "generator": "babiverse-test"}, "scene": 0, "scenes": [{"nodes": list(range(len(parts)))}],
           "nodes": nodes, "meshes": meshes, "accessors": accessors, "bufferViews": views,
           "buffers": [{"byteLength": len(blob)}], "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.6, 0.4, 1]}}]}
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    body = struct.pack("<II", len(js), CHUNK_JSON) + js + struct.pack("<II", len(blob), CHUNK_BIN) + blob
    return struct.pack("<4sII", GLB_MAGIC, 2, 12 + len(body)) + body
