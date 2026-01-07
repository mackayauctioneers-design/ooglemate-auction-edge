-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'dealer', 'internal');

-- Create user_roles table for secure role storage
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'dealer',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Create dealer_profiles table for dealer-specific data
CREATE TABLE public.dealer_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    dealer_name text NOT NULL,
    org_id text,
    region_id text NOT NULL DEFAULT 'CENTRAL_COAST_NSW',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_profiles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (prevents recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Security definer function to get user's role (prevents recursive RLS)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Security definer function to get dealer profile
CREATE OR REPLACE FUNCTION public.get_dealer_profile(_user_id uuid)
RETURNS TABLE(dealer_name text, org_id text, region_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dp.dealer_name, dp.org_id, dp.region_id
  FROM public.dealer_profiles dp
  WHERE dp.user_id = _user_id
  LIMIT 1
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Service can manage roles"
ON public.user_roles
FOR ALL
USING (true)
WITH CHECK (true);

-- RLS policies for dealer_profiles
CREATE POLICY "Users can view own profile"
ON public.dealer_profiles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
ON public.dealer_profiles
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Service can manage profiles"
ON public.dealer_profiles
FOR ALL
USING (true)
WITH CHECK (true);