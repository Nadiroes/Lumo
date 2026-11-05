#!/usr/bin/env python3
"""Vérifie les repos HuggingFace donnés par l'utilisateur + les poids YuE2."""
import json, urllib.request, sys

REPOS = [
    "huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF",
    "Edge0/Audio8-TTS-Realistic-Air",
    "google/embeddinggemma-2",
    "OpenMOSS-Team/MOSS-Image-SFT",
    "m-a-p/YuE2-3B",
    "m-a-p/YuE2-Vae",
]

def get(repo):
    url = f"https://huggingface.co/api/models/{repo}?blobs=true"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.load(r)
    except Exception as e:
        return {"__error__": str(e)}

for repo in REPOS:
    d = get(repo)
    print("=" * 70)
    print("REPO:", repo)
    if "__error__" in d:
        print("  ERREUR:", d["__error__"][:200])
        continue
    print("  pipeline_tag:", d.get("pipeline_tag"))
    print("  downloads:", d.get("downloads"), " likes:", d.get("likes"))
    sibs = d.get("siblings") or []
    total = 0
    files = []
    for s in sibs:
        sz = s.get("size") or 0
        total += sz
        if sz > 0:
            files.append((s["rfilename"], sz))
    files.sort(key=lambda x: -x[1])
    print(f"  total: {total/1e9:.2f} GB, {len(sibs)} fichiers")
    for name, sz in files[:14]:
        print(f"    - {name}  ({sz/1e6:.1f} MB)")
    cfg = d.get("config") or {}
    if cfg:
        print("  config:", json.dumps(cfg)[:300])
print("== FIN ==")
