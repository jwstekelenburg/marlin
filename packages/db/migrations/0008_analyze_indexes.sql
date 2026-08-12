-- Support tag co-occurrence / affinity joins for Analyze UI.
CREATE INDEX IF NOT EXISTS domain_tags_tag_id_idx ON domain_tags (tag_id);
