import "dotenv/config";

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN!;

async function clearAllRules() {
  console.log("Fetching current rules...");
  
  const response = await fetch("https://api.twitter.com/2/tweets/search/stream/rules", {
    headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
  });
  
  const data = await response.json();
  const rules = data.data || [];
  
  console.log(`Found ${rules.length} rules`);
  
  if (rules.length === 0) {
    console.log("No rules to delete");
    return;
  }
  
  const ids = rules.map((r: any) => r.id);
  console.log("Deleting rules:", ids);
  
  const deleteResponse = await fetch("https://api.twitter.com/2/tweets/search/stream/rules", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${X_BEARER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ delete: { ids } }),
  });
  
  const result = await deleteResponse.json();
  console.log("Delete result:", JSON.stringify(result.meta, null, 2));
  console.log("✅ All rules cleared!");
}

clearAllRules();
