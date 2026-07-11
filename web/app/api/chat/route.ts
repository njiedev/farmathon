import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${process.env.AGENT_API_URL ?? "http://127.0.0.1:8787"}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store"
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "The farm agent is unavailable." }, { status: 503 });
  }
}
