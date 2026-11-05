#!/usr/bin/env python3
"""Téléchargement de poids HF avec reprise intégrée (huggingface_hub).

Affiche des lignes JSON {file, downloaded, total, pct} pour la progression,
puis {ok: true} à la fin. Utilisé par vendor/pipelines (voir lib/lumo/pipelines.ts).
"""
import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--patterns", default="", help="patterns allow_patterns séparés par des virgules")
    ap.add_argument("--token", default=None)
    args = ap.parse_args()

    from huggingface_hub import snapshot_download

    patterns = [p for p in args.patterns.split(",") if p.strip()] or None
    token = args.token or os.environ.get("HF_TOKEN")

    def emit(obj):
        print(json.dumps(obj, ensure_ascii=False), flush=True)

    try:
        path = snapshot_download(
            repo_id=args.repo,
            local_dir=args.dir,
            allow_patterns=patterns,
            token=token,
            resume_download=True,
        )
        emit({"ok": True, "path": path})
    except Exception as e:  # noqa: BLE001 — le message part tel quel dans l'UI
        emit({"ok": False, "error": str(e)[:400]})
        sys.exit(1)


if __name__ == "__main__":
    main()
