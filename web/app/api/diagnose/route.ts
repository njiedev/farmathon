import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${process.env.MODEL_API_URL ?? "http://127.0.0.1:8001"}/predict`, {
      method: "POST",
      body: await request.formData(),
      cache: "no-store"
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "The diagnosis model is unavailable." }, { status: 503 });
  }
}
