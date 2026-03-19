import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Target, Flame, Bell, ArrowRight, TrendingUp, Clock, DollarSign } from 'lucide-react';
import carbitrageLogo from '@/assets/carbitrage-logo.jpg';

const VALUE_PROPS = [
  {
    icon: Target,
    title: 'Your Proven Winners',
    desc: 'See the exact models you sell fast — with real margins, real velocity.',
  },
  {
    icon: Flame,
    title: 'Live Matches Right Now',
    desc: 'Cars priced below market, matched to your buying profile. Updated daily.',
  },
  {
    icon: Bell,
    title: 'Never Miss Another Deal',
    desc: 'Get alerts when high-confidence opportunities hit — before your competitors.',
  },
];

const STATS = [
  { icon: DollarSign, value: '$4,200', label: 'Avg margin per match' },
  { icon: Clock, value: '18 days', label: 'Avg days to sell' },
  { icon: TrendingUp, value: '94%', label: 'Match accuracy' },
];

export default function InvitePage() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent" />
        <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-12 text-center">
          <img
            src={carbitrageLogo}
            alt="Carbitrage"
            className="w-48 sm:w-56 mx-auto mb-8 object-contain"
          />
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
            Find cars worth buying.
            <br />
            <span className="text-white/50">Before anyone else.</span>
          </h1>
          <p className="mt-4 text-white/40 text-lg max-w-md mx-auto">
            Carbitrage matches your sales history to live supply — showing you
            exactly what to buy, and what you'll make.
          </p>
          <Link to="/auth?mode=signup">
            <Button
              size="lg"
              className="mt-8 bg-white text-black hover:bg-white/90 text-base font-semibold px-8 py-6 rounded-lg"
            >
              Get Started
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          <p className="mt-3 text-white/25 text-sm">Free to try · No credit card required</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="max-w-3xl mx-auto px-6 py-8 grid grid-cols-3 gap-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <stat.icon className="h-5 w-5 mx-auto mb-2 text-white/30" />
              <div className="text-2xl sm:text-3xl font-bold tracking-tight">{stat.value}</div>
              <div className="text-xs text-white/40 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Value props */}
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-10">
        {VALUE_PROPS.map((prop, i) => (
          <div key={i} className="flex gap-5 items-start">
            <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
              <prop.icon className="h-5 w-5 text-white/60" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{prop.title}</h3>
              <p className="text-white/40 mt-1 text-sm leading-relaxed">{prop.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Testimonial */}
      <div className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="max-w-2xl mx-auto px-6 py-12 text-center">
          <blockquote className="text-lg sm:text-xl italic text-white/70 leading-relaxed">
            "I logged in and within 2 minutes saw a Prado listed $4,600 under market.
            That's the kind of edge I need."
          </blockquote>
          <p className="mt-4 text-sm text-white/30">— Independent dealer, NSW</p>
        </div>
      </div>

      {/* Final CTA */}
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold">
          Stop guessing. Start buying with confidence.
        </h2>
        <p className="mt-3 text-white/40 max-w-md mx-auto">
          Your first match is waiting. See what you should be buying right now.
        </p>
        <Link to="/auth?mode=signup">
          <Button
            size="lg"
            className="mt-8 bg-white text-black hover:bg-white/90 text-base font-semibold px-8 py-6 rounded-lg"
          >
            Get Started Free
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </Link>
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.06] py-6 text-center">
        <p className="text-xs text-white/20">
          Carbitrage · Powered by CaroogleAi · Automotive Truth
        </p>
        <Link to="/auth" className="text-xs text-white/30 underline mt-1 inline-block">
          Already have an account? Sign in
        </Link>
      </div>
    </div>
  );
}
