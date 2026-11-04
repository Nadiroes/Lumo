/** Test via @gradio/client officiel (gère le handshake ZeroGPU). */
import { Client } from "@gradio/client";

const TEST_LRC = [
  "[00:04.00] La lune pose un voile sur la ville endormie",
  "[00:08.50] Les rues murmurent des souvenirs d'hier",
  "[00:13.00] Et moi je marche, l'âme un peu grisée",
  "[00:17.50] Vers ce matin qui promet de revenir",
].join("\n");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const key = await db.apiKey.findFirst({ where: { provider: "huggingface" } });
  await db.$disconnect();
  const TOKEN = key?.secret || undefined;
  console.log("token:", TOKEN ? "présent" : "absent");

  const t0 = Date.now();
  const client = await Client.connect("ASLP-lab/DiffRhythm", TOKEN ? { hf_token: TOKEN as any } : ({} as any));
  console.log("connecté en", Math.round((Date.now() - t0) / 1000) + "s");

  // Test 1: endpoint paroles (rapide, sans GPU)
  try {
    const r1 = await client.predict("/R1_infer1", {
      theme: "un amour d'été perdu",
      tags_gen: "pop, piano, nostalgique",
      language: "en",
    });
    const data = (r1.data as any[])[0];
    console.log("R1 OK →", String(data).slice(0, 220).replace(/\n/g, " ⏎ "));
  } catch (e: any) {
    console.log("R1 ERREUR:", e?.message?.slice(0, 300));
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e);
  process.exit(1);
});
