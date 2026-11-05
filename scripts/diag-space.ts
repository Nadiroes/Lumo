/** Diagnostic ciblé du space DiffRhythm: statut HF + endpoints simples. */
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const key = await db.apiKey.findFirst({ where: { provider: "huggingface" } });
await db.$disconnect();
const TOKEN = key?.secret ?? "";
const H = { Authorization: `Bearer ${TOKEN}` };

// 1) statut runtime du space
const rt = await fetch("https://huggingface.co/api/spaces/ASLP-lab/DiffRhythm/runtime", { headers: H });
console.log("runtime http:", rt.status);
try {
  const j = await rt.json();
  console.log("stage:", j.stage, "| hardware:", JSON.stringify(j.hardware), "| gcTimeout:", j.gcTimeout);
} catch { console.log("runtime body non-JSON:", (await rt.text()).slice(0, 150)); }

// 2) version gradio du space
const cfg = await fetch("https://aslp-lab-diffrhythm.hf.space/config");
const cfgText = await cfg.text();
try {
  const c = JSON.parse(cfgText);
  console.log("gradio version:", c.version, "| components:", c.components?.length, "| auth:", !!c.auth);
} catch { console.log("config non-JSON:", cfgText.slice(0, 120)); }

// 3) endpoint paroles (LLM externe, pas de GPU)
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const r1 = await fetch("https://aslp-lab-diffrhythm.hf.space/gradio_api/call/R1_infer1", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...AUTH },
  body: JSON.stringify({ data: ["un amour d'été perdu", "pop, piano, nostalgique", "en"] }),
});
console.log("R1 POST:", r1.status, (await r1.text()).slice(0, 200));

// 4) suivre le flux R1
if (r1.status === 200) {
  const { event_id } = JSON.parse(await new Response((await fetch("https://aslp-lab-diffrhythm.hf.space/gradio_api/call/R1_infer1", { method: "POST", headers: { "Content-Type": "application/json", ...AUTH }, body: JSON.stringify({ data: ["un amour d'été perdu", "pop, piano, nostalgique", "en"] }) })).body).text());
  const sse = await fetch(`https://aslp-lab-diffrhythm.hf.space/gradio_api/call/R1_infer1/${event_id}`, { headers: AUTH });
  const t = await sse.text();
  console.log("R1 SSE:", sse.status, "→", t.slice(0, 500).replace(/\n/g, " | "));
}
