-- Connector identifiers are implementation details, never customer phone
-- numbers. Replace legacy values so raw database/API consumers do not expose
-- a provider brand in the contact record.
UPDATE public.contacts
SET phone = 'connected-contact-' || translate(
  id::text,
  '0123456789',
  'GHIJKLMNOP'
)
WHERE phone LIKE 'zernio:%';
