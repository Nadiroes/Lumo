/**
 * Test live de l'API du Hugging Face Space DiffRhythm (ASLP-lab/DiffRhythm)
 * Usage: bun scripts/test-diffrhythm-api.ts [with-token]
 */
const SPACE = "https://aslp-lab-diffrhythm.hf.space";
const GRADIO = `${SPACE}/gradio_api`;

const TEST_LRC = [
  "[00:04.00] La lune pose un voile sur la ville endormie",
  "[00:08.50] Les rues murmurent des souvenirs d'hier",
  "[00:13.00] Et moi je marche, l'âme un peu grisée",
  "[00:17.50] Vers ce matin qui promet de revenir",
].join("\n");

async function main() {
  const withToken = process.argv[2] === "with-token";
  let auth = "";
  if (withToken) {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const key = await db.apiKey.findFirst({ where: { provider: "huggingface" } });
    await db.$disconnect();
    if (key?.secret) auth = key.secret;
    console.log("token présent:", !!auth, "longueur:", auth.length);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = `Bearer ${auth}`;

  // Etape 0: healthcheck du space
  const health = await fetch(`${SPACE}/`, { headers }).then((r) => r.status);
  console.log("space status:", health);

  // Etape 0.5: upload de l'audio de référence (default.wav du space, 10s)
  const wavBytes = await import("fs/promises").then((fs) => fs.readFile("/tmp/default.wav"));
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(wavBytes)], { type: "audio/wav" }), "ref.wav");
  const upRes = await fetch(`${GRADIO}/upload`, { method: "POST", body: form });
  const upPath = (await upRes.json())[0];
  console.log("upload status:", upRes.status, "→ chemin serveur:", upPath);
  const refFile = { path: upPath, meta: { _type: "gradio.FileData" }, orig_name: "ref.wav" };

  // Etape 1: ouvrir une session d'appel
  const payload = {
    data: [
      TEST_LRC, // lrc
      refFile, // ref_audio_path (FileData)
      "melancholic french pop, soft piano, warm female vocals", // text_prompt
      0, // seed
      true, // randomize_seed
      32, // steps
      4.0, // cfg_strength
      "mp3", // file_type
      "euler", // odeint_method
      "speed first", // preference_infer
      95, // Music_Duration
    ],
  };
  const t0 = Date.now();
  const res = await fetch(`${GRADIO}/call/infer_music`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  console.log("POST /call status:", res.status);
  const body = await res.text();
  console.log("POST body:", body.slice(0, 300));
  if (res.status !== 200) {
    console.log("ECHEC ouverture session");
    process.exit(1);
  }
  const { event_id } = JSON.parse(body);
  console.log("event_id:", event_id, "→ en attente du flux SSE...");

  // Etape 2: consommer le flux SSE
  const sse = await fetch(`${GRADIO}/call/infer_music/${event_id}`, { headers });
  console.log("GET SSE status:", sse.status);
  const reader = sse.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const start = Date.now();
  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = chunk.split("\n");
      let event = "message";
      let data = "";
      for (const l of lines) {
        if (l.startsWith("event: ")) event = l.slice(7);
        else if (l.startsWith("data: ")) data += l.slice(6);
      }
      const elapsed = Math.round((Date.now() - start) / 1000);
      if (event === "process_starts") {
        console.log(`[${elapsed}s] GENERATION DEMARREE`, data.slice(0, 120));
      } else if (event === "progress") {
        console.log(`[${elapsed}s] PROGRESS`, data.slice(0, 160));
      } else if (event === "heartbeat") {
        console.log(`[${elapsed}s] … (queue/heartbeat)`);
      } else if (event === "process_completed") {
        console.log(`[${elapsed}s] COMPLETE`, data.slice(0, 600));
        break outer;
      } else if (event === "error") {
        console.log(`[${elapsed}s] ERREUR`, data.slice(0, 400));
        break outer;
      } else {
        console.log(`[${elapsed}s] ${event}`, data.slice(0, 120));
      }
    }
  }
  console.log("durée totale:", Math.round((Date.now() - t0) / 1000) + "s");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
