import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

export async function POST(request: NextRequest) {
  try {
    const { author_id, sample_tweet } = await request.json();
    
    if (!author_id) {
      return NextResponse.json({ error: "author_id required" }, { status: 400 });
    }

    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API not configured" }, { status: 503 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Check if avatar already exists
    const { data: existing } = await supabase
      .from("author_avatars")
      .select("avatar_data")
      .eq("author_id", author_id)
      .single();

    if (existing?.avatar_data) {
      return NextResponse.json({ 
        avatar_data: existing.avatar_data,
        cached: true 
      });
    }

    // Generate a description prompt based on the tweet
    const descriptionPrompt = `Based on this tweet, create a brief description (2-3 sentences) of what the author might look like as a professional profile picture. Consider their writing style, topic, and tone. Keep it realistic and appropriate.

Tweet: "${sample_tweet?.slice(0, 280) || 'General social media user'}"
Author handle: @${author_id}

Describe a realistic, professional-looking person for a profile photo. Include approximate age range, general appearance, setting (office, outdoors, etc), and mood/expression. Keep it neutral and professional.`;

    // First, get a description from Grok
    const descResponse = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-3-latest",
        messages: [
          { 
            role: "system", 
            content: "You create brief, professional descriptions for AI-generated profile pictures. Keep descriptions appropriate and realistic." 
          },
          { role: "user", content: descriptionPrompt }
        ],
        temperature: 0.7,
        max_tokens: 150
      })
    });

    if (!descResponse.ok) {
      console.error("Grok description error:", await descResponse.text());
      return NextResponse.json({ error: "Failed to generate description" }, { status: 500 });
    }

    const descData = await descResponse.json();
    const description = descData.choices?.[0]?.message?.content || "Professional person, neutral expression, clean background";

    // Now generate the image using Grok's image model
    const imagePrompt = `Professional profile picture photograph: ${description}. High quality, well-lit, sharp focus, suitable for social media profile. Photorealistic style.`;

    // Try to use Grok's image generation
    const imageResponse = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-2-image",
        prompt: imagePrompt,
        n: 1,
        size: "256x256",
        response_format: "b64_json"
      })
    });

    let avatarData: string;

    if (imageResponse.ok) {
      const imageData = await imageResponse.json();
      if (imageData.data?.[0]?.b64_json) {
        avatarData = `data:image/png;base64,${imageData.data[0].b64_json}`;
      } else if (imageData.data?.[0]?.url) {
        avatarData = imageData.data[0].url;
      } else {
        // Fallback to generating a unique gradient avatar
        avatarData = generateGradientAvatar(author_id);
      }
    } else {
      console.log("Image generation not available, using gradient avatar");
      // Generate a unique gradient avatar based on author_id
      avatarData = generateGradientAvatar(author_id);
    }

    // Store the avatar
    const { error: insertError } = await supabase
      .from("author_avatars")
      .upsert({
        author_id,
        avatar_data: avatarData,
        generation_prompt: imagePrompt,
        sample_tweet: sample_tweet?.slice(0, 500)
      });

    if (insertError) {
      console.error("Error storing avatar:", insertError);
    }

    return NextResponse.json({ 
      avatar_data: avatarData,
      cached: false 
    });

  } catch (error) {
    console.error("Avatar generation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Generate a unique gradient SVG avatar based on author_id
function generateGradientAvatar(authorId: string): string {
  // Create a hash from the author_id
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    const char = authorId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  // Generate colors from hash
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 40 + Math.abs(hash >> 8) % 60) % 360;
  const saturation = 65 + (Math.abs(hash >> 4) % 20);
  const lightness = 50 + (Math.abs(hash >> 12) % 15);
  
  const color1 = `hsl(${hue1}, ${saturation}%, ${lightness}%)`;
  const color2 = `hsl(${hue2}, ${saturation}%, ${lightness - 10}%)`;
  
  // Get initials
  const initial = authorId.charAt(0).toUpperCase();
  
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" fill="url(#grad)" rx="64"/>
      <text x="64" y="64" dy="0.35em" text-anchor="middle" fill="white" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="600">${initial}</text>
    </svg>
  `.trim();
  
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Batch endpoint to get multiple avatars at once
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const authorIds = searchParams.get("ids")?.split(",").filter(Boolean) || [];
    
    if (authorIds.length === 0) {
      return NextResponse.json({ avatars: {} });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const { data: avatars } = await supabase
      .from("author_avatars")
      .select("author_id, avatar_data")
      .in("author_id", authorIds);

    const avatarMap: Record<string, string> = {};
    (avatars || []).forEach(a => {
      avatarMap[a.author_id] = a.avatar_data;
    });

    return NextResponse.json({ avatars: avatarMap });
  } catch (error) {
    console.error("Avatar fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

