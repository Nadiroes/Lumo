#!/usr/bin/env python3
"""Téléchargement de poids HF — flux direct resolve/main avec reprise (Range).

Contrairement à snapshot_download (backend Xet, souvent bloqué/instable sur les
réseaux restreints), ce téléchargeur passe par les URLs publiques
https://huggingface.co/<repo>/resolve/main/<file> — le même chemin que le
moteur GGUF de Lumo, éprouvé. Reprise par requêtes Range + fichiers .part.

Affiche des lignes JSON {file, downloaded, total, pct} pour la progression,
puis {ok: true} à la fin. Utilisé par vendor/pipelines (lib/lumo/pipelines.ts).
"""
import argparse
import json
import os
import sys
import time
import urllib.request


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def list_files(repo: str, patterns, token):
    """Liste les fichiers du dépôt (API HF) filtrés par patterns (style fnmatch)."""
    import fnmatch

    req = urllib.request.Request(
        f"https://huggingface.co/api/models/{repo}?blobs=true",
        headers={"User-Agent": "Lumo", **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    siblings = data.get("siblings") or []
    files = []
    for s in siblings:
        name = s.get("rfilename") or ""
        size = int(s.get("size") or 0)
        if patterns:
            if not any(fnmatch.fnmatch(name, p) or fnmatch.fnmatch(name, f"**/{p}") or name.startswith(p.rstrip("*")) for p in patterns):
                continue
        files.append((name, size))
    return files


def fetch(repo: str, name: str, dest_dir: str, token: str | None) -> str:
    """Télécharge un fichier avec reprise Range. Retourne le chemin final.
    Gère le rate-limit HF (429) avec attente longue (Retry-After ou palier croissant)."""
    url = f"https://huggingface.co/{repo}/resolve/main/{name}"
    dest = os.path.join(dest_dir, name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"

    resume = os.path.getsize(part) if os.path.isfile(part) else 0
    headers = {"User-Agent": "Lumo"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if resume > 0:
        headers["Range"] = f"bytes={resume}-"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        # 200 (serveur ignore Range) → on repart de zéro ; 206 → reprise OK
        if r.status == 200 and resume > 0:
            resume = 0
        total = resume + int(r.headers.get("Content-Length") or 0)
        mode = "ab" if resume > 0 else "wb"
        done = resume
        last_emit = 0.0
        with open(part, mode) as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                now = time.time()
                if now - last_emit >= 2:
                    last_emit = now
                    pct = round(100 * done / total, 1) if total > 0 else 0
                    emit({"file": name, "downloaded": done, "total": total, "pct": pct})
    os.replace(part, dest)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--patterns", default="", help="patterns séparés par des virgules")
    ap.add_argument("--token", default=None)
    args = ap.parse_args()

    token = args.token or os.environ.get("HF_TOKEN")
    patterns = [p.strip() for p in args.patterns.split(",") if p.strip()] or None

    try:
        files = list_files(args.repo, patterns, token)
        if not files:
            emit({"ok": False, "error": f"Aucun fichier correspondant aux patterns dans {args.repo}"})
            sys.exit(1)
        total_all = sum(s for _, s in files)
        emit({"file": f"[{args.repo}] {len(files)} fichier(s)", "downloaded": 0, "total": total_all, "pct": 0})
        for name, size in files:
            dest = os.path.join(args.dir, name)
            if os.path.isfile(dest) and os.path.getsize(dest) == size and size > 0:
                emit({"file": name, "downloaded": size, "total": size, "pct": 100, "skip": True})
                continue
            wait = 45
            for essai in range(8):
                try:
                    fetch(args.repo, name, args.dir, token)
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 429 and essai < 7:
                        # Rate limit HF : Retry-After si fourni, sinon palier croissant (45 s → ~10 min)
                        retry_after = e.headers.get("Retry-After") if e.headers else None
                        delay = int(retry_after) if retry_after and retry_after.isdigit() else wait
                        delay = min(delay, 600)
                        emit({"file": name, "retry": essai + 1, "message": f"429 rate-limit — attente {delay} s"})
                        time.sleep(delay)
                        wait = min(wait * 2, 600)
                        continue
                    raise
                except Exception as e:  # noqa: BLE001 — reprise au prochain essai
                    if essai >= 2:
                        raise
                    emit({"file": name, "retry": essai + 1, "message": str(e)[:200]})
                    time.sleep(3 * (essai + 1))
        emit({"ok": True, "path": args.dir, "files": len(files), "bytes": total_all})
    except Exception as e:  # noqa: BLE001 — le message part tel quel dans l'UI
        emit({"ok": False, "error": str(e)[:400]})
        sys.exit(1)


if __name__ == "__main__":
    main()
