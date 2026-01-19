// seed.js
async function seed() {
    const feedbackItems = [
      { text: "Login page is extremely slow", source: "Ticket #101" },
      { text: "I love the new dark mode!", source: "Twitter" },
      { text: "App crashes when I upload a PNG", source: "GitHub Issue" },
      { text: "Billing history is missing", source: "Email" },
      { text: "Can we get an export to PDF feature?", source: "Community Forum" }
    ];
  
    console.log("🌱 Starting seed...");
  
    for (const item of feedbackItems) {
      try {
        const response = await fetch("http://localhost:8787/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
  
        if (response.ok) {
          console.log(`✅ Sent: "${item.text}"`);
        } else {
          const err = await response.text();
          console.log(`❌ Failed: ${err}`);
        }
      } catch (error) {
        console.log(`❌ Network Error:Is the server running?`);
      }
    }
    console.log("✨ Seeding complete!");
  }
  
  seed();