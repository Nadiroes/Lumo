"""Test DiffRhythm space via gradio_client python (reference pour ZeroGPU)."""
import json
import sys

TEST_LRC = """[00:04.00] La lune pose un voile sur la ville endormie
[00:08.50] Les rues murmurent des souvenirs d'hier
[00:13.00] Et moi je marche, l'âme un peu grisée
[00:17.50] Vers ce matin qui promet de revenir"""

def get_token():
    from dotenv import load_dotenv
    try:
        from prisma import Prisma  # noqa
    except Exception:
        pass
    # lecture directe sqlite (sans dépendance prisma python)
    import sqlite3
    from pathlib import Path
    db_path = None
    for cand in Path("/home/z/my-project/db").glob("*.db"):
        db_path = cand
    if db_path is None:
        return None
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT secret FROM ApiKey WHERE provider='huggingface' LIMIT 1").fetchone()
    conn.close()
    return row[0] if row else None

def main():
    token = get_token()
    print("token:", "présent" if token else "absent")
    from gradio_client import Client, handle_file
    client = Client("ASLP-lab/DiffRhythm", token=token, verbose=False)
    print("connecté")

    # Test 1: paroles
    try:
        r = client.predict("/R1_infer1", theme="un amour d'été perdu", tags_gen="pop, piano, nostalgique", language="en", api_name="/R1_infer1")
        print("R1 OK →", str(r)[:200].replace("\n", " ⏎ "))
    except Exception as e:
        print("R1 ERREUR:", str(e)[:400])

    # Test 2: infer_music avec ref = fichier local uploadé automatiquement
    try:
        r = client.predict(
            lrc=TEST_LRC,
            ref_audio_path=handle_file("/tmp/default.wav"),
            text_prompt="melancholic french pop, soft piano, warm female vocals",
            seed=0,
            randomize_seed=True,
            steps=32,
            cfg_strength=4.0,
            file_type="mp3",
            odeint_method="euler",
            preference_infer="speed first",
            Music_Duration=95,
            api_name="/infer_music",
        )
        print("MUSIC OK →", r)
    except Exception as e:
        print("MUSIC ERREUR:", str(e)[:500])

if __name__ == "__main__":
    main()
