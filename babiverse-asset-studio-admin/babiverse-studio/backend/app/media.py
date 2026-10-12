"""Médiathèque : contrôle, stockage et service des fichiers importés.

- Les fichiers sont stockés sur disque (`BABIVERSE_MEDIA_DIR/<2 premiers caractères>/<sha256>.<ext>`), adressés
  par leur empreinte : deux imports identiques partagent le même fichier. La base ne garde que les métadonnées.
- Le type est déterminé par la SIGNATURE du contenu, pas par l'extension ni par le type annoncé.
- Formats acceptés : SVG (assaini, voir svgsafe.py), PNG, WebP, JPEG, GIF. Les formats 3D (GLB/glTF) sont refusés :
  aucun pipeline de rendu 3D n'existe dans l'atelier.
- Une ressource remplacée garde son identifiant (les assets qui la référencent suivent) ; l'ancienne révision
  reste sur disque et les versions publiées continuent de pointer vers la révision figée à leur publication.
- Les fichiers sont servis par des liens signés (HMAC, valables 12 h) : une balise <img> ne peut pas envoyer
  d'en-tête d'authentification.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import struct
import time

from . import svgsafe

RASTER = {"image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif"}
EXT_MIME = {"svg": "image/svg+xml", **{v: k for k, v in RASTER.items()}}
MEDIA_CATEGORIES = {"character_part": "Composant de personnage", "component": "Composant modulaire", "sprite": "Sprite d'objet", "texture": "Texture de surface",
                    "cover": "Image de couverture", "pattern": "Motif", "other": "Autre"}
SAFE_NAME = re.compile(r"[^A-Za-z0-9_.\-]+")


class MediaError(ValueError):
    pass


def sniff(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    head = data[:512].lstrip(b"\xef\xbb\xbf").lstrip()
    if head.startswith(b"<?xml") or head.startswith(b"<svg") or b"<svg" in data[:2048]:
        return "image/svg+xml"
    if data[:4] == b"glTF" or data[:1] == b"{" and b'"asset"' in data[:4096]:
        return "model/gltf"
    return None


def raster_size(data: bytes, mime: str) -> tuple[int, int] | None:
    try:
        if mime == "image/png":
            return struct.unpack(">II", data[16:24])
        if mime == "image/gif":
            return struct.unpack("<HH", data[6:10])
        if mime == "image/webp":
            chunk = data[12:16]
            if chunk == b"VP8X":
                w = int.from_bytes(data[24:27], "little") + 1
                h = int.from_bytes(data[27:30], "little") + 1
                return w, h
            if chunk == b"VP8L":
                b = data[21:25]
                bits = int.from_bytes(b, "little")
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
            if chunk == b"VP8 ":
                w, h = struct.unpack("<HH", data[26:30])
                return w & 0x3FFF, h & 0x3FFF
            return None
        if mime == "image/jpeg":
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    return w, h
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                seg = struct.unpack(">H", data[i + 2:i + 4])[0]
                i += 2 + seg
    except struct.error:
        return None
    return None


def inspect(data: bytes, filename: str, max_bytes: int, max_px: int) -> dict:
    """Contrôle complet d'un fichier. Retourne {mime, ext, kind, width, height, meta, data} (data = contenu à stocker)."""
    if not data:
        raise MediaError("Fichier vide.")
    if len(data) > max_bytes:
        raise MediaError(f"Fichier trop volumineux : {len(data) / 1048576:.1f} Mo (maximum {max_bytes // 1048576} Mo).")
    mime = sniff(data)
    if mime == "model/gltf":
        raise MediaError("Les modèles 3D (glTF/GLB) ne sont pas acceptés : l'atelier n'a pas de rendu 3D.")
    if mime is None:
        raise MediaError("Format non reconnu. Formats acceptés : SVG, PNG, WebP, JPEG, GIF.")
    if mime == "image/svg+xml":
        try:
            res = svgsafe.sanitize(data)
        except svgsafe.SvgError as exc:
            raise MediaError(str(exc)) from exc
        meta = {k: res[k] for k in ("view_box", "colors", "channels", "recolorable", "has_back_layer", "warnings", "removed")}
        return {"mime": mime, "ext": "svg", "kind": "svg", "width": res["width"], "height": res["height"],
                "meta": meta, "data": res["svg"].encode("utf-8")}
    size = raster_size(data, mime)
    if not size or size[0] <= 0 or size[1] <= 0:
        raise MediaError("Image illisible ou corrompue (dimensions introuvables).")
    if max(size) > max_px:
        raise MediaError(f"Image trop grande : {size[0]}×{size[1]} px (maximum {max_px} px de côté).")
    return {"mime": mime, "ext": RASTER[mime], "kind": "raster", "width": size[0], "height": size[1],
            "meta": {"warnings": []}, "data": data}


def safe_filename(name: str) -> str:
    base = os.path.basename(name or "fichier")
    return SAFE_NAME.sub("_", base)[:120] or "fichier"


def store(media_dir: str, data: bytes, ext: str) -> tuple[str, str]:
    """Écrit le fichier s'il n'existe pas ; retourne (sha256, chemin relatif)."""
    sha = hashlib.sha256(data).hexdigest()
    rel = os.path.join(sha[:2], f"{sha}.{ext}")
    path = os.path.join(media_dir, rel)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    return sha, rel


def path_for(media_dir: str, sha: str, mime: str) -> str:
    ext = "svg" if mime == "image/svg+xml" else RASTER.get(mime, "bin")
    return os.path.join(media_dir, sha[:2], f"{sha}.{ext}")


def read(media_dir: str, sha: str, mime: str) -> bytes:
    with open(path_for(media_dir, sha, mime), "rb") as f:
        return f.read()


# ---------------------------------------------------------------- liens signés

def sign(secret: str, media_id: str, revision: int, exp: int) -> str:
    msg = f"{media_id}:{revision}:{exp}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()[:32]


def signed_url(secret: str, media_id: str, revision: int) -> str:
    # expiration arrondie à l'heure : URL stable pendant une heure (cache navigateur)
    exp = (int(time.time()) // 3600 + 13) * 3600
    return f"/api/media/{media_id}/file?rev={revision}&exp={exp}&sig={sign(secret, media_id, revision, exp)}"


def check_signature(secret: str, media_id: str, revision: int, exp: int, sig: str) -> bool:
    if exp < time.time():
        return False
    return hmac.compare_digest(sign(secret, media_id, revision, exp), sig)
