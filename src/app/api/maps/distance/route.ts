import { NextResponse } from "next/server";
import { z } from "zod";

// MANDATORY PATTERN:
// Client → /api/maps/* (Next.js) → Google Maps API → Client
// Never call Google APIs directly from frontend code.

const ReqSchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
});

export async function POST(req: Request) {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) {
    return NextResponse.json({ error: "GOOGLE_MAPS_KEY not configured" }, { status: 500 });
  }

  const json = await req.json().catch(() => null);
  const parsed = ReqSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { origin, destination } = parsed.data;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destinations", `${destination.lat},${destination.lng}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("units", "metric");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => null);

  return NextResponse.json(data, { status: res.ok ? 200 : 502 });
}

