/**
 * Cloudflare RAG Feedback Dashboard
 * Serverless backend that ingests unstructured product feedback,
 * vectorizes it, and allows for semantic search.
 */

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
				},
			});
		}

		// POST /ingest endpoint
		if (request.method === 'POST' && path === '/ingest') {
			try {
				const body = await request.json();
				const { text, source, region, user_id, timestamp, urgency_level } = body;

				// Validate required input
				if (!text || typeof text !== 'string') {
					return new Response(
						JSON.stringify({ error: 'Missing or invalid "text" field' }),
						{
							status: 400,
							headers: {
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				}

				if (!source || typeof source !== 'string') {
					return new Response(
						JSON.stringify({ error: 'Missing or invalid "source" field' }),
						{
							status: 400,
							headers: {
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				}

				// Generate UUID
				const id = crypto.randomUUID();

				// Map input fields
				const originalText = text;
				const feedbackTimestamp = timestamp || new Date().toISOString();

				// AI Agent Step: Analyze feedback using Llama 3
				const systemPrompt = `You are a Product Feedback AI. Analyze this feedback and return JSON with:

{
  "sentiment_score": Integer (1-10). 10 is thrilled, 1 is angry.
  "nps_class": "Promoter" (9-10), "Passive" (7-8), "Detractor" (0-6).
  "urgency_level": "High" | "Neutral" | "Low"
  "user_type": "Enterprise" | "SMB" | "Individual" | "Unknown"
  "product_category": Infer from text (e.g., "Workers", "Pages", "R2", "D1", "Zero Trust", "Unknown")
  "feedback_type": "UX" | "Tech" | "Service" | "Feature Request"
  "summary": Max 20 words
  "recommended_action": Short actionable step
}

Return ONLY valid JSON, no additional text.`;

				let aiData = {};

				try {
					const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
						messages: [
							{
								role: 'system',
								content: systemPrompt,
							},
							{
								role: 'user',
								content: `Analyze this feedback: ${originalText}`,
							},
						],
					});

					// Parse AI response - handle cases where Llama adds extra text
					// Response format: { response: "..." } or { description: "..." } or direct string
					let responseText = '';
					if (typeof aiResponse === 'string') {
						responseText = aiResponse;
					} else if (aiResponse.response) {
						responseText = aiResponse.response;
					} else if (aiResponse.description) {
						responseText = aiResponse.description;
					} else if (aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message) {
						responseText = aiResponse.choices[0].message.content;
					} else {
						responseText = JSON.stringify(aiResponse);
					}

					// Try to find JSON object in the response (handle markdown code blocks or extra text)
					const jsonMatch = responseText.match(/\{[\s\S]*\}/);
					if (jsonMatch) {
						aiData = JSON.parse(jsonMatch[0]);
					} else {
						// Fallback: try parsing the entire response
						aiData = JSON.parse(responseText);
					}
				} catch (aiError) {
					// Handling both AI inference errors (500s) and parsing errors
					console.error('AI Processing Failed (using defaults):', aiError);
					aiData = {
						sentiment_score: 5,
						nps_class: 'Passive',
						urgency_level: 'Neutral',
						product_category: 'Unknown',
						feedback_type: 'UX',
						user_type: 'Unknown',
						summary: originalText.substring(0, 50),
						recommended_action: 'Review manually',
					};
				}

				// Ensure all required fields have defaults
				const sentimentScore = aiData.sentiment_score !== undefined ? aiData.sentiment_score : 5;
				// Calculate nps_class from sentiment_score if not provided
				let npsClass = aiData.nps_class;
				if (!npsClass && sentimentScore !== undefined) {
					if (sentimentScore >= 9) {
						npsClass = 'Promoter';
					} else if (sentimentScore >= 7) {
						npsClass = 'Passive';
					} else {
						npsClass = 'Detractor';
					}
				} else if (!npsClass) {
					npsClass = 'Passive';
				}
				const urgencyLevel = urgency_level || aiData.urgency_level || 'Neutral';
				const productCategory = aiData.product_category || 'Unknown';
				const feedbackType = aiData.feedback_type || 'UX';
				const userType = aiData.user_type || 'Individual';
				const summary = aiData.summary || originalText.substring(0, 50);
				const recommendedAction = aiData.recommended_action || 'Review feedback';

				// Generate embeddings using Workers AI for vectorization
				const embeddingResponse = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
					text: [originalText],
				});

				// Extract embedding vector from response
				// The response format is typically { data: [[...vector...]] }
				const embedding = embeddingResponse.data[0];

				// Insert into D1 database with all fields
				await env.DB.prepare(
					`INSERT INTO feedback (
						id, feedback_timestamp, user_id, source, product_category,
						user_type, urgency_level, feedback_type, region,
						summary, recommended_action, feedback_status, original_text,
						sentiment_score, nps_class
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
					.bind(
						id,
						feedbackTimestamp,
						user_id || null,
						source,
						productCategory,
						userType,
						urgencyLevel,
						feedbackType,
						region || null,
						summary,
						recommendedAction,
						'Open',
						originalText,
						sentimentScore,
						npsClass
					)
					.run();

				// Insert embedding into Vectorize
				try {
					await env.VECTOR_INDEX.insert([
						{
							id: id,
							values: embedding,
							metadata: {
								text: originalText.substring(0, 100), // Store first 100 chars as metadata
								source: source,
								product_category: productCategory,
								urgency_level: urgencyLevel,
							},
						},
					]);
				} catch (vectorError) {
					console.error('Failed to insert into Vectorize (ignoring for D1 success):', vectorError);
				}

				return new Response(
					JSON.stringify({
						id,
						message: 'Feedback ingested successfully',
						ai_analysis: {
							sentiment_score: sentimentScore,
							nps_class: npsClass,
							urgency_level: urgencyLevel,
							product_category: productCategory,
							feedback_type: feedbackType,
							user_type: userType,
							summary: summary,
							recommended_action: recommendedAction,
						},
					}),
					{
						status: 201,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Failed to ingest feedback',
						details: error.message,
					}),
					{
						status: 500,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
		}

		// GET /all endpoint - Fetch all feedback from D1
		if (request.method === 'GET' && path === '/all') {
			try {
				// Fetch all feedback from D1 database
				const dbResults = await env.DB.prepare(
					'SELECT * FROM feedback ORDER BY feedback_timestamp DESC'
				).all();

				const results = dbResults.results.map((row) => ({
					id: row.id,
					feedback_timestamp: row.feedback_timestamp,
					user_id: row.user_id,
					source: row.source,
					product_category: row.product_category,
					user_type: row.user_type,
					urgency_level: row.urgency_level,
					feedback_type: row.feedback_type,
					region: row.region,
					summary: row.summary,
					recommended_action: row.recommended_action,
					feedback_status: row.feedback_status,
					original_text: row.original_text,
					sentiment_score: row.sentiment_score,
					nps_class: row.nps_class,
				}));

				return new Response(
					JSON.stringify({
						results: results,
						total: results.length,
					}),
					{
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Failed to fetch feedback',
						details: error.message,
					}),
					{
						status: 500,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
		}

		// GET /search endpoint
		if (request.method === 'GET' && path === '/search') {
			try {
				const query = url.searchParams.get('q');

				// Validate input
				if (!query || typeof query !== 'string') {
					return new Response(
						JSON.stringify({ error: 'Missing or invalid "q" query parameter' }),
						{
							status: 400,
							headers: {
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				}

				// Generate embeddings for the search term
				const embeddingResponse = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
					text: [query],
				});

				const queryEmbedding = embeddingResponse.data[0];

				// Query Vectorize for top 5 closest vectors
				const vectorResults = await env.VECTOR_INDEX.query(queryEmbedding, {
					topK: 5,
					returnMetadata: true,
				});

				// Extract IDs from vector results
				const ids = vectorResults.matches.map((match) => match.id);

				if (ids.length === 0) {
					return new Response(
						JSON.stringify({
							results: [],
							query: query,
						}),
						{
							status: 200,
							headers: {
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				}


				// Fetch full text details from D1
				const placeholders = ids.map(() => '?').join(',');
				const dbResults = await env.DB.prepare(
					`SELECT * FROM feedback WHERE id IN (${placeholders})`
				)
					.bind(...ids)
					.all();

				// Combine vector similarity scores with database results
				const results = dbResults.results.map((row) => {
					const vectorMatch = vectorResults.matches.find(
						(match) => match.id === row.id
					);
					return {
						id: row.id,
						feedback_timestamp: row.feedback_timestamp,
						user_id: row.user_id,
						source: row.source,
						product_category: row.product_category,
						user_type: row.user_type,
						urgency_level: row.urgency_level,
						feedback_type: row.feedback_type,
						region: row.region,
						summary: row.summary,
						recommended_action: row.recommended_action,
						feedback_status: row.feedback_status,
						original_text: row.original_text,
						sentiment_score: row.sentiment_score,
						nps_class: row.nps_class,
						// Keep backward compatibility fields
						text: row.original_text,
						created_at: row.feedback_timestamp,
						score: vectorMatch ? vectorMatch.score : null,
					};
				});

				// Sort by score (highest first)
				results.sort((a, b) => (b.score || 0) - (a.score || 0));

				return new Response(
					JSON.stringify({
						query: query,
						results: results,
					}),
					{
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Failed to search feedback',
						details: error.message,
					}),
					{
						status: 500,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
		}

		// Handle unknown routes (SPA Fallback)
		return env.ASSETS.fetch(request);
	},
};