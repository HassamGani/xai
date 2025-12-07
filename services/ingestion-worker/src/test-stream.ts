import "dotenv/config";

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;

if (!X_BEARER_TOKEN) {
  console.error("❌ X_BEARER_TOKEN not set in environment");
  process.exit(1);
}

async function testXApi() {
  console.log("🔍 Testing X API connection...\n");

  // 1. Test authentication
  console.log("1️⃣ Testing authentication...");
  try {
    const meResponse = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
    });

    if (meResponse.ok) {
      const data = await meResponse.json();
      console.log(`   ✅ Authenticated as: @${data.data?.username || "unknown"}`);
    } else {
      const error = await meResponse.text();
      console.log(`   ❌ Auth failed: ${meResponse.status} - ${error}`);
      
      if (meResponse.status === 403) {
        console.log("   ⚠️  You may need Elevated access for some endpoints");
      }
    }
  } catch (e) {
    console.log(`   ❌ Auth error: ${e}`);
  }

  // 2. Check current stream rules
  console.log("\n2️⃣ Checking current stream rules...");
  try {
    const rulesResponse = await fetch(
      "https://api.twitter.com/2/tweets/search/stream/rules",
      { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } }
    );

    if (rulesResponse.ok) {
      const data = await rulesResponse.json();
      const rules = data.data || [];
      console.log(`   ✅ Found ${rules.length} active rules`);
      
      if (rules.length > 0) {
        console.log("   Rules:");
        rules.forEach((r: any) => {
          console.log(`      - [${r.tag}] ${r.value}`);
        });
      }
    } else {
      const error = await rulesResponse.text();
      console.log(`   ❌ Rules check failed: ${rulesResponse.status}`);
      
      if (rulesResponse.status === 403) {
        console.log("   ⚠️  Filtered stream requires Elevated or Academic access!");
        console.log("   📝 Apply at: https://developer.twitter.com/en/portal/products");
      } else {
        console.log(`   Error: ${error}`);
      }
    }
  } catch (e) {
    console.log(`   ❌ Rules error: ${e}`);
  }

  // 3. Try to connect to stream briefly
  console.log("\n3️⃣ Testing stream connection (5 seconds)...");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const streamResponse = await fetch(
      "https://api.twitter.com/2/tweets/search/stream?tweet.fields=author_id,created_at",
      {
        headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (streamResponse.ok) {
      console.log("   ✅ Stream connection successful!");
      console.log("   📡 Listening for 5 seconds...\n");

      const reader = streamResponse.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let tweetCount = 0;

        const readTimeout = setTimeout(() => {
          reader.cancel();
        }, 5000);

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value);
            const lines = text.split("\n").filter((l) => l.trim());

            for (const line of lines) {
              try {
                const data = JSON.parse(line);
                if (data.data) {
                  tweetCount++;
                  console.log(`   📨 Tweet received: "${data.data.text?.slice(0, 60)}..."`);
                }
              } catch {}
            }
          }
        } catch (e: any) {
          if (e.name !== "AbortError") throw e;
        }

        clearTimeout(readTimeout);
        console.log(`\n   📊 Received ${tweetCount} tweets in 5 seconds`);
        
        if (tweetCount === 0) {
          console.log("   ℹ️  No tweets received - this is normal if no rules match or low traffic");
        }
      }
    } else {
      const error = await streamResponse.text();
      console.log(`   ❌ Stream connection failed: ${streamResponse.status}`);
      
      if (streamResponse.status === 403) {
        console.log("\n   🚫 ACCESS DENIED - Filtered stream requires Elevated access!");
        console.log("   📝 Your current access level doesn't support filtered stream.");
        console.log("   🔗 Apply for Elevated access: https://developer.twitter.com/en/portal/products");
      } else if (streamResponse.status === 429) {
        console.log("   ⏳ Rate limited - wait a bit and try again");
      } else {
        console.log(`   Error: ${error}`);
      }
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.log("   ✅ Stream test completed (timed out as expected)");
    } else {
      console.log(`   ❌ Stream error: ${e}`);
    }
  }

  console.log("\n✨ Test complete!");
}

testXApi();

