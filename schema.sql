DROP TABLE IF EXISTS feedback;
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  feedback_timestamp TEXT,
  user_id TEXT,
  source TEXT,
  product_category TEXT,
  user_type TEXT,
  urgency_level TEXT,
  feedback_type TEXT,
  region TEXT,
  summary TEXT,
  recommended_action TEXT,
  feedback_status TEXT,
  original_text TEXT,
  sentiment_score INTEGER,
  nps_class TEXT
);
