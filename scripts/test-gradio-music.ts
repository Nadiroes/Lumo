/** Test infer_music via @gradio/client avec erreurs détaillées. */
import { Client } from "@gradio/client";

const TEST_LRC = [
  "[00:04.00] La lune pose un voile sur la ville endormie",
  "[00:08.50] Les rues murmurent des souvenirs d'hier",
  "[00:13.00] Et moi je marche, l'âme un peu grisée",
  "[00:17.50] Vers ce matin qui promet de revenir",
].join("\n");

function dump(tag: string, e: unknown) {
  const err = e as any;
  console.log(`--- ${tag} ---`);
  console.log("message:", err?.message);
  if (err?.message && err.message.includes("Error") && err.response) console.log("response:", err.response);
  console.log("keys:", err && typeof err === "object" ? Object.keys(err) : typeof err);
  try {
    console.log("full:", JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 600));
  } catch { /* ignore */ }
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const key = await db.apiKey.findFirst({ where: { provider: "huggingface" } });
  await db.$disconnect();
  const TOKEN = key?.secret || undefined;

  const client = await Client.connect("https://aslp-lab-diffrhythm.hf.space", { token: TOKEN as any } as any);
  console.log("connecté");

  // Test A: ref via URL distante + paramètres nommés
  try {
    const job = client.submit("/infer_music", {
      lrc: TEST_LRC,
      ref_audio_path: {
        path: null as any,
        url: "https://aslp-lab-diffrhythm.hf.space/gradio_api/file=/tmp/gradio/7dd149741461a340ce266a592220819babdfbf51c8f99e3f548951af826bfc15/ref.wav",
        meta: { _type: "gradio.FileData" },
      },
      text_prompt: "melancholic french pop, soft piano, warm female vocals",
      seed: 0,
      randomize_seed: true,
      steps: 32,
      cfg_strength: 4.0,
      file_type: "mp3",
      odeint_method: "euler",
      preference_infer: "speed first",
      Music_Duration: 95,
    });
    const tStart = Date.now();
    let gotData = false;
    const timer = setTimeout(() => { console.log("⏱ timeout 210s atteint"); job.cancel(); process.exit(0); }, 210_000);
    for await (const ev of job) {
      const { type, data } = ev as any;
      const ts = Math.round((Date.now() - tStart) / 1000);
      const dstr = JSON.stringify(data);
      console.log(`[${ts}s][${type}]`, dstr ? dstr.slice(0, 400) : "");
      if (type === "data") { gotData = true; break; }
      if (type === "status" && data?.stage === "error") { console.log("→ STAGE ERROR"); break; }
    }
    clearTimeout(timer);
  } catch (e) {
    dump("infer_music erreur", e);
  }
}

main().catch((e) => {
  dump("FATAL", e);
  process.exit(1);
});
