#!/usr/bin/env python3
"""Runner TTS Audio8-TTS-Realistic-Air (0.6B, 23 langues, clonage de voix).

Entrée (stdin JSON) : {output, text, refAudio?, refText?, maxNewTokens?}
Sortie : {"ok": true, "audio": "<wav>", "sampleRate": <int>}.

Sans référence : la voix par défaut du modèle est utilisée.
Avec refAudio (wav/mp3) + refText (transcription exacte) : clonage zéro-shot.
"""
import json
import os
import sys


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main():
    req = json.load(sys.stdin)
    out_dir = req["output"]
    text = str(req.get("text") or "").strip()
    if not text:
        emit({"stage": "error", "message": "Texte vide."})
        sys.exit(1)

    model_dir = os.environ.get("AUDIO8_DIR")
    if not model_dir or not os.path.isdir(model_dir):
        emit({"stage": "error", "message": "Poids Audio8 TTS absents — lancez d'abord le téléchargement des poids."})
        sys.exit(1)

    emit({"stage": "load", "message": "Chargement d'Audio8 TTS (0.6B)…"})
    import torch
    import soundfile as sf
    from transformers import AutoModel, AutoProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    # BF16 partout : le dépôt recommande BF16 (GPU) ; sur CPU il divise la RAM par 2
    # (0.6B ≈ 1,2 Go au lieu de 2,4 Go) — indispensable sur les petites machines.
    dtype = torch.bfloat16

    processor = AutoProcessor.from_pretrained(model_dir, trust_remote_code=True)
    model = AutoModel.from_pretrained(model_dir, trust_remote_code=True, dtype=dtype).eval().to(device)
    emit({"stage": "loaded", "device": device, "dtype": "bfloat16"})

    kwargs = {}
    ref_audio = req.get("refAudio")
    ref_text = req.get("refText")
    if ref_audio and ref_text:
        # refAudio : chemin absolu d'un fichier déjà déposé sur la machine
        if not os.path.isfile(ref_audio):
            emit({"stage": "error", "message": f"Fichier de référence introuvable : {ref_audio}"})
            sys.exit(1)
        kwargs = {"reference_audio": [ref_audio], "reference_text": [str(ref_text)]}
        emit({"stage": "clone", "message": "Clonage de voix à partir de la référence…"})

    inputs = processor(text=[text], return_tensors="pt", **kwargs)
    inputs = {k: v.to(device) for k, v in inputs.items()}

    max_new = int(req.get("maxNewTokens") or 1024)
    with torch.inference_mode():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new,
            temperature=0.8,
            top_p=0.95,
            top_k=50,
            do_sample=True,
            return_dict_in_generate=True,
        )
        waveforms, lengths = model.decode_audio(out.codes)

    audio = waveforms[0, : int(lengths[0])].float().cpu().numpy()
    out_path = os.path.join(out_dir, "speech.wav")
    sf.write(out_path, audio, model.config.codec_sample_rate)
    emit({"ok": True, "audio": out_path, "sampleRate": int(model.config.codec_sample_rate)})


if __name__ == "__main__":
    main()
