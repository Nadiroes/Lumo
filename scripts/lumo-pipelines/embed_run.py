#!/usr/bin/env python3
"""Runner embeddings EmbeddingGemma 2 (multimodal — texte ici).

Entrée (stdin JSON) : {output, texts: [...]}  (output inutilisé, présent pour l'homogénéité)
Sortie : {"ok": true, "dim": <int>, "embeddings": [[...], ...], "normalized": true}.

Poolage moyen + normalisation L2 (conforme 1_Pooling + 2_Normalize du dépôt).
"""
import json
import os
import sys


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main():
    req = json.load(sys.stdin)
    texts = [str(t) for t in (req.get("texts") or []) if str(t).strip()]
    if not texts:
        emit({"stage": "error", "message": "Aucun texte à vectoriser."})
        sys.exit(1)

    model_dir = os.environ.get("EMBED_DIR")
    if not model_dir or not os.path.isdir(model_dir):
        emit({"stage": "error", "message": "Poids EmbeddingGemma absents — lancez d'abord le téléchargement des poids."})
        sys.exit(1)

    emit({"stage": "load", "message": f"Chargement d'EmbeddingGemma 2 pour {len(texts)} texte(s)…"})
    import torch
    from transformers import AutoModel, AutoTokenizer

    model = AutoModel.from_pretrained(model_dir, trust_remote_code=True).eval()
    tok = AutoTokenizer.from_pretrained(model_dir, trust_remote_code=True)
    emit({"stage": "loaded"})

    batch = tok(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
    with torch.inference_mode():
        out = model(**batch)
        hidden = getattr(out, "last_hidden_state", None)
        if hidden is None and hasattr(out, "sentence_embedding"):
            vecs = out.sentence_embedding
        else:
            mask = batch["attention_mask"].unsqueeze(-1).to(hidden.dtype)
            vecs = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
        vecs = torch.nn.functional.normalize(vecs, dim=-1)

    emit(
        {
            "ok": True,
            "dim": int(vecs.shape[-1]),
            "normalized": True,
            "embeddings": [[round(float(x), 6) for x in row] for row in vecs],
        }
    )


if __name__ == "__main__":
    main()
