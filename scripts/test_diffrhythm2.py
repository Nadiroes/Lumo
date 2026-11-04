"""Test generation reelle sur ASLP-lab/DiffRhythm2 (modele v2 du lien utilisateur)."""
import sqlite3
from pathlib import Path

def get_token():
    for cand in Path("/home/z/my-project/db").glob("*.db"):
        conn = sqlite3.connect(cand)
        row = conn.execute("SELECT secret FROM ApiKey WHERE provider='huggingface' LIMIT 1").fetchone()
        conn.close()
        if row:
            return row[0]
    return None

LRC = """[start]
[intro]
[verse]
La lune pose un voile sur la ville endormie
Les rues murmurent des souvenirs d'hier
Et moi je marche, l'âme un peu grisée
Vers ce matin qui promet de revenir
[chorus]
Emporte-moi, emporte-moi
La ou le ciel touche la mer
Emporte-moi, emporte-moi
Loin des hivers de fer
[verse]
Les lampadsaires comptent mes pas
Chaque fenetre garde un secret
Et si demain se souvient de moi
Je lui laisse le temps d'un refrain
[chorus]
Emporte-moi, emporte-moi
La ou le ciel touche la mer
Emporte-moi, emporte-moi
Loin des hivers de fer
[outro]"""

def main():
    token = get_token()
    print("token:", "présent" if token else "absent")
    from gradio_client import Client, handle_file
    import time
    t0 = time.time()
    client = Client("ASLP-lab/DiffRhythm2", token=token, verbose=False)
    print(f"connecté en {time.time()-t0:.1f}s")

    t0 = time.time()
    try:
        result = client.predict(
            lrc=LRC,
            audio_prompt=None,
            text_prompt="French pop, soft piano, warm female vocals, melancholic",
            seed=0,
            randomize_seed=True,
            steps=16,
            cfg_strength=1.3,
            file_type="mp3",
            odeint_method="euler",
            api_name="/infer_music",
        )
        print(f"MUSIC OK en {time.time()-t0:.1f}s →", result)
        if isinstance(result, (list, tuple)):
            fp = result[0]
        else:
            fp = result
        p = Path(str(fp))
        print("fichier:", p, "| taille:", p.stat().st_size if p.exists() else "?")
    except Exception as e:
        print(f"MUSIC ERREUR après {time.time()-t0:.1f}s:", str(e)[:600])

if __name__ == "__main__":
    main()
