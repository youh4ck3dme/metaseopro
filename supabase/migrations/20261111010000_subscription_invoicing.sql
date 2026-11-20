-- Migration: Add last_invoice_number and last_invoice_url to public.subscriptions
-- Allows storing SuperFaktura / Fakturoid invoice numbers and download links

ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS last_invoice_number text,
ADD COLUMN IF NOT EXISTS last_invoice_url text;
