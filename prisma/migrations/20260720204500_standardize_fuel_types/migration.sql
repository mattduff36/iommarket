-- Standardize selectable fuel types for new and edited vehicle listings.
-- Existing "Hybrid" and "Plug-in Hybrid" listing values are intentionally retained
-- so they remain visible and available through the legacy search filter.
UPDATE "AttributeDefinition"
SET options = '["Petrol","Diesel","Electric","Petrol Hybrid","Diesel Hybrid","Petrol Plug-in Hybrid","Diesel Plug-in Hybrid"]'
WHERE slug = 'fuel-type';
