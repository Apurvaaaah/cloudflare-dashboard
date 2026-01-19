DROP TABLE IF EXISTS feedback;

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  feedback_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT,
  source TEXT,
  product_category TEXT DEFAULT 'Unknown',
  user_type TEXT DEFAULT 'Unknown',
  urgency_level TEXT,
  feedback_type TEXT,
  region TEXT DEFAULT 'Unknown',
  summary TEXT,
  recommended_action TEXT,
  feedback_status TEXT DEFAULT 'Open',
  original_text TEXT,
  sentiment_score INTEGER,
  nps_class TEXT
);
