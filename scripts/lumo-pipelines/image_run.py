#!/usr/bin/env python3
"""Runner image MOSS-Image-SFT (text-to-image 5B, pipeline diffusers).

Entrée (stdin JSON) : {output, prompt, steps?, width?, height?, negativePrompt?}
Sortie : {"ok": true, "image": "<png>"}.

La classe MOSSImagePipeline est déclarée par le dépôt (model_index.json) ;
on tente l'import direct puis le chargement générique diffusers.
"""
import json
import os
import sys


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main():
    req = json.load(sys.stdin)
    out_dir = req["output"]
    prompt = str(req.get("prompt") or "").strip()
    if not prompt:
        emit({"stage": "error", "message": "Prompt vide."})
        sys.exit(1)

    model_dir = os.environ.get("MOSS_DIR")
    if not model_dir or not os.path.isdir(model_dir):
        emit({"stage": "error", "message": "Poids MOSS-Image absents — lancez d'abord le téléchargement des poids (27 Go)."})
        sys.exit(1)

    emit({"stage": "load", "message": "Chargement de MOSS-Image-SFT (5B)…"})
    import torch

    pipe = None
    try:
        from diffusers import MOSSImagePipeline  # type: ignore[attr-defined]

        pipe = MOSSImagePipeline.from_pretrained(model_dir)
    except Exception:
        from diffusers import DiffusionPipeline

        pipe = DiffusionPipeline.from_pretrained(model_dir, trust_remote_code=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipe = pipe.to(device)
    emit({"stage": "loaded", "device": device})

    steps = max(8, min(60, int(req.get("steps") or 30)))
    width = int(req.get("width") or 1024)
    height = int(req.get("height") or 1024)
    negative = req.get("negativePrompt")

    emit({"stage": "generate", "message": f"Génération {width}×{height} en {steps} pas…"})
    gen = torch.Generator(device=device)
    gen.manual_seed(int(req.get("seed") or 0) or torch.randint(0, 2**31 - 1, (1,)).item())
    kwargs = {"prompt": prompt, "num_inference_steps": steps, "width": width, "height": height, "generator": gen}
    if negative:
        kwargs["negative_prompt"] = str(negative)
    result = pipe(**kwargs)
    image = result.images[0]

    out_path = os.path.join(out_dir, "image.png")
    image.save(out_path)
    emit({"ok": True, "image": out_path})


if __name__ == "__main__":
    main()
