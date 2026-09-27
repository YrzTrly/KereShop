-- WhatsApp Cloud API identifiers needed to send outbound messages from the
-- phone number the business connected in Meta Business Manager.

ALTER TABLE integrations ADD COLUMN whatsapp_phone_number_id TEXT;
ALTER TABLE integrations ADD COLUMN whatsapp_business_account_id TEXT;