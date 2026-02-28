// Stripe product/price mapping for Carbitrage plans
export const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 0,
    priceLabel: 'Free',
    stripe_price_id: null,
    stripe_product_id: null,
    features: [
      '1 active hunt',
      'Basic auction feed',
      'Manual refresh',
    ],
    limits: { maxHunts: 1, push: false, email: false, sms: false, auction: false },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 249,
    priceLabel: '$249/mo',
    stripe_price_id: 'price_1T5uwCCExfJSi0xwVSlEqqGp',
    stripe_product_id: 'prod_U432SibxcRULB3',
    features: [
      'Up to 10 hunts',
      'Push & email alerts',
      'Full auction data',
      'OogleBot AI assistant',
      'Sales insights',
    ],
    limits: { maxHunts: 10, push: true, email: true, sms: false, auction: true },
    popular: true,
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    price: 499,
    priceLabel: '$499/mo',
    stripe_price_id: 'price_1T5vFACExfJSi0xwiDNQqmZA',
    stripe_product_id: 'prod_U43LxDJ8RJRhRX',
    features: [
      'Unlimited hunts',
      'Push, email & SMS alerts',
      'Full auction data',
      'OogleBot AI assistant',
      'Priority support',
      'Dedicated account manager',
    ],
    limits: { maxHunts: -1, push: true, email: true, sms: true, auction: true },
  },
} as const;

export type PlanId = keyof typeof PLANS;
