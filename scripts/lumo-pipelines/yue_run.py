#!/usr/bin/env python3
"""Runner YuE 2 — studio musical open source (bloc Labs, option 2).

Entrée (stdin JSON) : {output, style, lyrics?, cot?, seed?, instrumental?}
Sortie : événements NDJSON puis {"ok": true, "audio": "...", "truncated": {...}}.

Le score éditable (ABC) est conservé à côté de l'audio dans le dossier de sortie.
"""
import json
import os
import sys


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main():
    req = json.load(sys.stdin)
    out_dir = req["output"]

    model_dir = os.environ.get("YUE2_MODEL_DIR")
    vae_dir = os.environ.get("YUE2_VAE_DIR")
    if not model_dir or not os.path.isdir(model_dir):
        emit({"stage": "error", "message": "Poids YuE2-3B absents — lancez d'abord le téléchargement des poids."})
        sys.exit(1)
    if not vae_dir or not os.path.isdir(vae_dir):
        emit({"stage": "error", "message": "Décodeur YuE2-Vae absent — lancez d'abord le téléchargement des poids."})
        sys.exit(1)

    emit({"stage": "load", "message": "Chargement de YuE2-3B en mémoire…"})
    import torch

    from yue2 import YuE2Pipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    emit({"stage": "loaded", "device": device})

    style = str(req.get("style") or "pop, piano, warm vocals")
    if req.get("instrumental"):
        style = f"{style}, instrumental, no vocals"
    lyrics = str(req.get("lyrics") or "").strip()
    cot = str(req.get("cot") or "full")
    seed = req.get("seed")

    kwargs = {"style": style, "lyrics": lyrics, "cot": cot if cot in ("full", "melody", "off") else "full"}
    if isinstance(seed, int):
        kwargs["seed"] = seed

    emit({"stage": "compose", "message": "Composition du plan mélodie/accords puis synthèse audio…"})
    with YuE2Pipeline.from_pretrained(model_dir, vae=vae_dir, device=device) as pipe:
        song = pipe(**kwargs)
        song.save_artifacts(out_dir)
        truncated = dict(song.truncated) if getattr(song, "truncated", None) else {}

    audio = os.path.join(out_dir, "audio.flac")
    score = os.path.join(out_dir, "score.abc")
    emit(
        {
            "ok": True,
            "audio": audio if os.path.isfile(audio) else out_dir,
            "score": score if os.path.isfile(score) else None,
            "truncated": truncated,
            "device": device,
        }
    )


if __name__ == "__main__":
    main()
