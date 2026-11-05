/** Test @gradio/client predict() sur DiffRhythm2 (audio_prompt=None, sans fichier). */
import { Client } from "@gradio/client";

const LRC = `[start]
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
[outro]`;

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const key = await db.apiKey.findFirst({ where: { provider: "huggingface" } });
  await db.$disconnect();
  const token = key?.secret || undefined;
  console.log("token:", token ? "présent" : "absent");

  const t0 = Date.now();
  const client = await Client.connect("https://aslp-lab-diffrhythm2.hf.space", { token } as any);
  console.log("connecté en", Math.round((Date.now() - t0) / 1000) + "s");

  const t1 = Date.now();
  try {
    const res = await client.predict("/infer_music", {
      lrc: LRC,
      audio_prompt: null,
      text_prompt: "French pop, soft piano, warm female vocals, melancholic",
      seed: 0,
      randomize_seed: true,
      steps: 16,
      cfg_strength: 1.3,
      file_type: "mp3",
      odeint_method: "euler",
    });
    const data = (res.data as any[])[0];
    console.log("MUSIC OK en", Math.round((Date.now() - t1) / 1000) + "s");
    console.log("résultat:", JSON.stringify(data).slice(0, 400));
    if (data?.url) {
      const dl = await fetch(data.url);
      const buf = await dl.arrayBuffer();
      console.log("téléchargé:", buf.byteLength, "octets | status:", dl.status);
    }
  } catch (e: any) {
    console.log("MUSIC ERREUR en", Math.round((Date.now() - t1) / 1000) + "s:", String(e?.message ?? e).slice(0, 500));
  }
}

main().catch((e) => {
  console.error("FATAL:", String(e?.message ?? e).slice(0, 300));
  process.exit(1);
});
