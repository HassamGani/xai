import { NextResponse } from "next/server";

export async function POST() {
  // DISABLED: Experiments API usage is deactivated to save API costs
  return NextResponse.json({ 
    error: "Experiments are temporarily disabled", 
    message: "API usage for experiments has been deactivated" 
  }, { status: 503 });
}
