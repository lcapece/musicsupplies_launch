-- Create promo_codes table
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) NOT NULL UNIQUE, 
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('percent_off', 'dollars_off')),
  value DECIMAL NOT NULL CHECK (value > 0),
  min_order_value DECIMAL DEFAULT 0 CHECK (min_order_value >= 0),
  max_uses INTEGER DEFAULT NULL,
  uses_remaining INTEGER DEFAULT NULL,
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_date_range CHECK (start_date <= end_date),
  CONSTRAINT valid_uses CHECK (max_uses IS NULL OR uses_remaining IS NULL OR uses_remaining <= max_uses)
);

-- Create promo_code_usage table to track usage
CREATE TABLE IF NOT EXISTS promo_code_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  account_number VARCHAR(50) NOT NULL,
  order_id INTEGER REFERENCES web_orders(id) ON DELETE SET NULL,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  order_value DECIMAL NOT NULL,
  discount_amount DECIMAL NOT NULL,
  
  CONSTRAINT valid_discount CHECK (discount_amount >= 0)
);

-- Add RLS policies
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usage ENABLE ROW LEVEL SECURITY;

-- Admin can manage all promo codes
CREATE POLICY "Admin can manage promo codes" ON promo_codes
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = '999');

-- All authenticated users can view active promo codes
CREATE POLICY "Users can view active promo codes" ON promo_codes
  FOR SELECT TO authenticated
  USING (is_active = TRUE AND (start_date <= CURRENT_TIMESTAMP) AND (end_date >= CURRENT_TIMESTAMP));

-- Admin can manage usage tracking
CREATE POLICY "Admin can manage promo code usage" ON promo_code_usage
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = '999');

-- Users can see their own promo code usage
CREATE POLICY "Users can view own promo code usage" ON promo_code_usage
  FOR SELECT TO authenticated
  USING (account_number = auth.jwt() ->> 'sub');

-- Create function to check if a promo code is valid and available for a user
CREATE OR REPLACE FUNCTION check_promo_code_validity(
  p_code TEXT,
  p_account_number TEXT,
  p_order_value DECIMAL
)
RETURNS TABLE (
  is_valid BOOLEAN,
  message TEXT,
  promo_id UUID,
  promo_type TEXT,
  promo_value DECIMAL,
  discount_amount DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promo promo_codes%ROWTYPE;
  v_usage_count INTEGER;
  v_discount_amount DECIMAL;
BEGIN
  -- Get promo code details (convert to uppercase for case insensitivity)
  SELECT * INTO v_promo
  FROM promo_codes
  WHERE UPPER(code) = UPPER(p_code)
    AND is_active = TRUE
    AND start_date <= CURRENT_TIMESTAMP
    AND end_date >= CURRENT_TIMESTAMP;
  
  -- Check if promo code exists and is active
  IF v_promo.id IS NULL THEN
    RETURN QUERY SELECT 
      FALSE, 
      'Invalid or expired promo code.',
      NULL::UUID,
      NULL::TEXT,
      NULL::DECIMAL,
      NULL::DECIMAL;
    RETURN;
  END IF;
  
  -- Check if minimum order value is met
  IF p_order_value < v_promo.min_order_value THEN
    RETURN QUERY SELECT 
      FALSE, 
      'Order value does not meet minimum requirement of $' || v_promo.min_order_value::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::DECIMAL,
      NULL::DECIMAL;
    RETURN;
  END IF;
  
  -- Check if there are uses remaining (if limited)
  IF v_promo.max_uses IS NOT NULL AND v_promo.uses_remaining <= 0 THEN
    RETURN QUERY SELECT 
      FALSE, 
      'This promo code has reached its usage limit.',
      NULL::UUID,
      NULL::TEXT,
      NULL::DECIMAL,
      NULL::DECIMAL;
    RETURN;
  END IF;
  
  -- Calculate discount amount
  IF v_promo.type = 'percent_off' THEN
    v_discount_amount := p_order_value * (v_promo.value / 100.0);
  ELSE -- dollars_off
    v_discount_amount := v_promo.value;
    -- Ensure discount doesn't exceed order value
    IF v_discount_amount > p_order_value THEN
      v_discount_amount := p_order_value;
    END IF;
  END IF;
  
  -- Return success with promo details
  RETURN QUERY SELECT 
    TRUE, 
    'Promo code applied successfully: ' || v_promo.name,
    v_promo.id,
    v_promo.type,
    v_promo.value,
    v_discount_amount;
END;
$$;

-- Create function to record promo code usage
CREATE OR REPLACE FUNCTION record_promo_code_usage(
  p_promo_id UUID,
  p_account_number TEXT,
  p_order_id INTEGER,
  p_order_value DECIMAL,
  p_discount_amount DECIMAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert usage record
  INSERT INTO promo_code_usage (
    promo_code_id, account_number, order_id, order_value, discount_amount
  ) VALUES (
    p_promo_id, p_account_number, p_order_id, p_order_value, p_discount_amount
  );
  
  -- Update uses_remaining if applicable
  UPDATE promo_codes
  SET uses_remaining = uses_remaining - 1
  WHERE id = p_promo_id
    AND uses_remaining IS NOT NULL;
  
  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

-- Function to get the best promo code for a user
CREATE OR REPLACE FUNCTION get_best_promo_code(p_account_number TEXT)
RETURNS TABLE (
  code TEXT,
  name TEXT,
  description TEXT,
  type TEXT,
  value DECIMAL,
  min_order_value DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.code,
    pc.name,
    'Save ' || 
      CASE 
        WHEN pc.type = 'percent_off' THEN pc.value::TEXT || '%'
        ELSE '$' || pc.value::TEXT
      END ||
      CASE
        WHEN pc.min_order_value > 0 THEN ' on orders over $' || pc.min_order_value::TEXT
        ELSE ''
      END ||
      CASE
        WHEN pc.max_uses IS NOT NULL THEN ' (Limited time offer)'
        ELSE ''
      END as description,
    pc.type,
    pc.value,
    pc.min_order_value
  FROM promo_codes pc
  WHERE pc.is_active = TRUE
    AND pc.start_date <= CURRENT_TIMESTAMP
    AND pc.end_date >= CURRENT_TIMESTAMP
    AND (pc.max_uses IS NULL OR pc.uses_remaining > 0)
  ORDER BY
    -- Prioritize percent_off over dollars_off for simplicity
    CASE WHEN pc.type = 'percent_off' THEN 1 ELSE 0 END DESC,
    -- Higher value is better
    pc.value DESC,
    -- Lower minimum order value is better
    pc.min_order_value ASC
  LIMIT 1;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_promo_code_validity TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_promo_code_usage TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_best_promo_code TO anon, authenticated;

-- Insert sample promo codes
INSERT INTO promo_codes (code, name, type, value, min_order_value, max_uses, uses_remaining, start_date, end_date, is_active)
VALUES
  ('SAVE5', '5% Off Your Order', 'percent_off', 5, 0, 3, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '60 days', TRUE),
  ('1PCT', 'Small Discount', 'percent_off', 1, 0, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days', TRUE),
  ('SUMMER25', 'Summer Special $25 Off', 'dollars_off', 25, 100, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '90 days', TRUE);
