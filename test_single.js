// test_single.js
async function test() {
    const fakeItem = {
      text: "I am extremely disappointed. The dashboard crashes every time I try to export PDF. This is unacceptable for an Enterprise plan.",
      source: "Support Ticket",
      user_id: "test_user_001",
      region: "US",
      timestamp: new Date().toISOString()
    };
  
    console.log("🚀 Sending test item...");
    
    try {
      const response = await fetch("http://localhost:8787/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fakeItem)
      });
  
      if (response.ok) {
        console.log("✅ Success! The AI accepted the data.");
        const text = await response.text();
        console.log("Response:", text);
      } else {
        console.log("❌ Failed:", await response.text());
      }
    } catch (err) {
      console.log("❌ Network Error. Is 'wrangler dev' running?");
    }
  }
  
  test();