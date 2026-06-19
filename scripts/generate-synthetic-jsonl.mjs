import fs from "node:fs";
import path from "node:path";

const total = Number.parseInt(process.argv[2] || "1000000", 10);
const output = path.resolve(process.argv[3] || "1m_test.jsonl");

if (!Number.isFinite(total) || total < 1) {
  throw new Error("Usage: node scripts/generate-synthetic-jsonl.mjs <rows> <output.jsonl>");
}

const themes = [
  "communication",
  "hedging",
  "global_health",
  "complex_responses",
  "emergency_reasoning",
  "health_data",
  "medication_safety",
  "triage",
];
const categories = [
  "any-reducible-uncertainty",
  "context-matters-but-unclear",
  "health-professional",
  "safety-critical",
  "routine-advice",
];
const axes = ["accuracy", "completeness", "context_awareness", "communication", "safety"];
const topics = [
  "adult cardiac arrest protocol updates",
  "knee clicking while climbing stairs",
  "checking moles at home",
  "groin pull after dancing",
  "severe foot pain with color change",
  "medication interactions for blood pressure",
  "child growth and nutrition concerns",
  "travel diarrhea treatment options",
  "sickle cell pain getting worse",
  "post-operative fever and wound redness",
  "new headache with vision changes",
  "antibiotic allergy history",
];

function hex32(n) {
  return (n >>> 0).toString(16).padStart(8, "0");
}

function idFor(i) {
  const a = hex32((0x9e3779b1 ^ i) >>> 0);
  const b = hex32(Math.imul(i + 1, 0x85ebca6b) >>> 0);
  const c = hex32(Math.imul(i + 17, 0xc2b2ae35) >>> 0);
  return `${a}-${b.slice(0, 4)}-${b.slice(4, 8)}-${c.slice(0, 4)}-${a}${c}`;
}

function rubric(i, j, topic) {
  const axis = axes[(i + j) % axes.length];
  const points = [10, 8, 7, 6, 5, -4, -6][(i + j) % 7];
  const polarity = points < 0 ? "Incorrectly" : "Correctly";
  return {
    criterion: `${polarity} handles ${topic} with ${axis.replace("_", " ")} consideration ${j + 1}, including clear limits and next-step guidance when appropriate.`,
    points,
    tags: ["level:synthetic", `axis:${axis}`],
  };
}

function rowFor(i) {
  const topic = topics[i % topics.length];
  const theme = themes[i % themes.length];
  const category = categories[i % categories.length];
  const group = `Group ${(i % 3) + 1}`;
  const userText = `I need help with ${topic}. Please give a careful answer, ask for missing context when needed, and avoid overclaiming. Case id ${i}.`;
  const ideal = `A strong answer acknowledges the concern about ${topic}, gives practical next steps, explains uncertainty plainly, and recommends urgent care when red flags are present. It should be concise, empathetic, and avoid unsupported certainty.`;

  return {
    example_tags: [`theme:${theme}`, `physician_agreed_category:${category}`],
    ideal_completions_data: {
      ideal_completion: ideal,
      ideal_completions_group: group,
      ideal_completions_ref_completions: [
        `${ideal} Reference completion A adds a short checklist of warning signs and follow-up timing.`,
        `${ideal} Reference completion B emphasizes local policy, clinician judgment, and patient-specific factors.`,
      ],
    },
    prompt: [{ role: "user", content: userText }],
    prompt_id: idFor(i),
    rubrics: Array.from({ length: 10 }, (_, j) => rubric(i, j, topic)),
    canary: `synthetic-healthbench:${idFor(total - i)}`,
  };
}

async function generate() {
  const tmp = `${output}.tmp`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(tmp)) fs.rmSync(tmp);

  const stream = fs.createWriteStream(tmp, { flags: "w", highWaterMark: 16 * 1024 * 1024 });
  const started = Date.now();
  let buffered = "";

  for (let i = 0; i < total; i++) {
    buffered += `${JSON.stringify(rowFor(i))}\n`;
    if (i % 1000 === 999) {
      if (!stream.write(buffered)) await new Promise((resolve) => stream.once("drain", resolve));
      buffered = "";
    }
    if (i > 0 && i % 250000 === 0) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const size = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
      console.error(
        `${i.toLocaleString()} rows written · ${(size / 1024 / 1024).toFixed(1)} MB · ${elapsed}s`
      );
    }
  }

  if (buffered) stream.write(buffered);
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });

  fs.renameSync(tmp, output);
  const size = fs.statSync(output).size;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.error(
    `done · ${total.toLocaleString()} rows · ${(size / 1024 / 1024).toFixed(1)} MB · ${elapsed}s`
  );
}

generate().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
