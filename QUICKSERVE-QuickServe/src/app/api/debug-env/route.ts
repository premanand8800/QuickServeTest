import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    AUTH_URL: process.env.AUTH_URL ? "SET" : "MISSING",
    DATABASE_URL: process.env.DATABASE_URL ? "SET" : "MISSING",
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH?.slice(0, 50) + "...",
  });
}
