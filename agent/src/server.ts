import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Anthropic from "@anthropic-ai/sdk";

import { createAnthropicMessageClient } from "./anthropic/message-client.js";
import { runAgent } from "./anthropic/run-agent.js";
import { cropLookupTool } from "./tools/crop-lookup.js";
import { diagnosisTool, type DiagnosisOutput } from "./tools/diagnose-image.js";
import { weatherTool, type WeatherOutput } from "./tools/weather.js";

interface FarmProfile { farmName: string; location: string; crop: string; acres: number }
interface ChatTurn { role: "user" | "assistant"; content: string }
interface ChatRequest { sessionId: string; message: string; profile: FarmProfile; diagnosis?: DiagnosisOutput }
interface Session { turns: ChatTurn[] }

const sessions = new Map<string, Session>();
const tools = [cropLookupTool, weatherTool, diagnosisTool] as const;

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "http://localhost:3000",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(data));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function textFromAnthropic(content: Anthropic.Messages.ContentBlock[]): string {
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

async function demoResponse(input: ChatRequest, session: Session): Promise<{ message: string; weather?: WeatherOutput; diagnosis?: DiagnosisOutput; alerts: string[] }> {
  const lower = input.message.toLowerCase();
  let weather: WeatherOutput | undefined;
  if (session.turns.length === 0 || /weather|rain|frost|plant|spray|irrigat|today|tomorrow/.test(lower)) {
    weather = await weatherTool.execute({ location: input.profile.location });
  }
  const cropResult = /soil|ph|corn|crop|plant/.test(lower)
    ? await cropLookupTool.execute({ crop: input.profile.crop })
    : undefined;
  const alerts = weather?.alerts ?? [];
  const previousUserTurn = [...session.turns].reverse().find((turn) => turn.role === "user");
  let message: string;
  if (input.diagnosis !== undefined) {
    const confidence = Math.round(input.diagnosis.confidence * 100);
    message = input.diagnosis.uncertain
      ? `I can’t call this confidently yet. ${input.diagnosis.display_name} is the leading match at ${confidence}%, but ${input.diagnosis.guidance}`
      : `The leaf is most consistent with ${input.diagnosis.display_name} (${confidence}% model confidence). ${input.diagnosis.guidance}`;
  } else if (/what did i (ask|say)|earlier|last time|remember/.test(lower) && previousUserTurn !== undefined) {
    message = `Earlier you asked, “${previousUserTurn.content}” I’m still using your ${input.profile.crop} profile for ${input.profile.farmName} near ${input.profile.location}.`;
  } else if (weather !== undefined) {
    const today = weather.daily[0];
    message = `For ${input.profile.farmName} near ${weather.location}, it’s ${Math.round(weather.current.temperatureF)}°F now. Today’s range is ${Math.round(today?.lowF ?? 0)}–${Math.round(today?.highF ?? 0)}°F with a ${Math.round(today?.precipitationChance ?? 0)}% rain chance.`;
    if (/spray/.test(lower) && (today?.precipitationChance ?? 0) >= 50) message += " I’d hold the spray pass until the rain window clears and recheck wind before application.";
    if (alerts[0] !== undefined) message += ` I also noticed: ${alerts[0]}`;
  } else if (cropResult?.found === true) {
    message = `${cropResult.crop.crop[0]?.toUpperCase()}${cropResult.crop.crop.slice(1)} does best around pH ${cropResult.crop.soilPhMin}–${cropResult.crop.soilPhMax}. ${cropResult.crop.notes}`;
  } else if (session.turns.length > 0) {
    message = `I remember we’re working with ${input.profile.crop} at ${input.profile.farmName}. Ask me about today’s field conditions, soil needs, or upload a leaf photo and I’ll check it.`;
  } else {
    message = `I’ve got ${input.profile.farmName}: ${input.profile.acres} acres of ${input.profile.crop} near ${input.profile.location}. What should we check first?`;
  }
  return { message, ...(weather === undefined ? {} : { weather }), ...(input.diagnosis === undefined ? {} : { diagnosis: input.diagnosis }), alerts };
}

async function handleChat(input: ChatRequest): Promise<unknown> {
  const session = sessions.get(input.sessionId) ?? { turns: [] };
  sessions.set(input.sessionId, session);
  let result: { message: string; weather?: WeatherOutput; diagnosis?: DiagnosisOutput; alerts: string[] };
  if (process.env.ANTHROPIC_API_KEY !== undefined) {
    const client = createAnthropicMessageClient(process.env.ANTHROPIC_API_KEY);
    const history = session.turns.slice(-8).map((turn) => `${turn.role}: ${turn.content}`).join("\n");
    const response = await runAgent(client, {
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      userMessage: `${history}\nuser: ${input.message}`,
      tools,
      systemPrompt: `You are FarmAgent, a concise farm operations assistant. Farm profile: ${JSON.stringify(input.profile)}. Use tools for factual claims. State classifier uncertainty and controlled-dataset limits.`
    });
    result = { message: textFromAnthropic(response.content), alerts: [] };
  } else {
    result = await demoResponse(input, session);
  }
  session.turns.push({ role: "user", content: input.message }, { role: "assistant", content: result.message });
  return { ...result, sessionTurns: session.turns.length, mode: process.env.ANTHROPIC_API_KEY === undefined ? "demo" : "anthropic" };
}

const port = Number(process.env.AGENT_PORT ?? 8787);
createServer(async (request, response) => {
  if (request.method === "OPTIONS") { response.writeHead(204, { "access-control-allow-origin": "http://localhost:3000", "access-control-allow-headers": "content-type" }); response.end(); return; }
  try {
    if (request.method === "GET" && request.url === "/health") { sendJson(response, 200, { status: "ok", sessions: sessions.size }); return; }
    if (request.method === "POST" && request.url === "/chat") { sendJson(response, 200, await handleChat(await readJson(request) as ChatRequest)); return; }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
}).listen(port, "127.0.0.1", () => console.log(`FarmAgent API listening on http://127.0.0.1:${port}`));
