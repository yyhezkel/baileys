-- Create stories table with aggregated counts
CREATE TABLE IF NOT EXISTS stories (
    id SERIAL PRIMARY KEY,
    story_id VARCHAR(255) UNIQUE NOT NULL,
    session_id VARCHAR(255) NOT NULL,
    account_phone_number VARCHAR(50),
    message_id VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'text', 'image', 'video', 'audio'
    content TEXT,
    caption TEXT,
    background_color VARCHAR(20),
    font INTEGER,
    can_be_reshared BOOLEAN DEFAULT TRUE,

    -- Aggregated counts
    views_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    reactions_count INTEGER DEFAULT 0,
    replies_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Indexes for faster queries
    CONSTRAINT stories_story_id_key UNIQUE (story_id)
);

-- Create story_events table for individual events
CREATE TABLE IF NOT EXISTS story_events (
    id SERIAL PRIMARY KEY,
    story_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(20) NOT NULL, -- 'view', 'like', 'reaction', 'reply'
    participant_number VARCHAR(50) NOT NULL,
    participant_name VARCHAR(255),

    -- Event-specific data
    emoji VARCHAR(10), -- For reactions
    message TEXT, -- For replies

    -- Timestamps
    delivered_at TIMESTAMP WITH TIME ZONE,
    viewed_at TIMESTAMP WITH TIME ZONE,
    played_at TIMESTAMP WITH TIME ZONE,
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Foreign key
    FOREIGN KEY (story_id) REFERENCES stories(story_id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_stories_session_id ON stories(session_id);
CREATE INDEX IF NOT EXISTS idx_stories_account_phone ON stories(account_phone_number);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at);

CREATE INDEX IF NOT EXISTS idx_story_events_story_id ON story_events(story_id);
CREATE INDEX IF NOT EXISTS idx_story_events_type ON story_events(event_type);
CREATE INDEX IF NOT EXISTS idx_story_events_participant ON story_events(participant_number);
CREATE INDEX IF NOT EXISTS idx_story_events_timestamp ON story_events(event_timestamp);

-- Create function to update story counts
CREATE OR REPLACE FUNCTION update_story_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE stories
        SET
            views_count = (SELECT COUNT(*) FROM story_events WHERE story_id = NEW.story_id AND event_type = 'view'),
            likes_count = (SELECT COUNT(*) FROM story_events WHERE story_id = NEW.story_id AND event_type = 'like'),
            reactions_count = (SELECT COUNT(*) FROM story_events WHERE story_id = NEW.story_id AND event_type = 'reaction'),
            replies_count = (SELECT COUNT(*) FROM story_events WHERE story_id = NEW.story_id AND event_type = 'reply'),
            updated_at = NOW()
        WHERE story_id = NEW.story_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update counts when events are added
CREATE TRIGGER trigger_update_story_counts
AFTER INSERT ON story_events
FOR EACH ROW
EXECUTE FUNCTION update_story_counts();

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER trigger_stories_updated_at
BEFORE UPDATE ON stories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
