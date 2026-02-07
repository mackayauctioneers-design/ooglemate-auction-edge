import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Upload, 
  FileText, 
  Bell, 
  Clock, 
  CheckCircle2, 
  ArrowRight,
  BarChart3,
  Users,
  Zap
} from 'lucide-react';
import { KitingWingMarkVideo } from '@/components/kiting';

export default function HelpPage() {
  const steps = [
    {
      icon: Upload,
      title: "1. Upload Auction Data",
      description: "Admin uploads auction rows into Auction_Opportunities each day from various auction houses (Manheim, Grays, Pickles, etc.)",
      role: "Admin",
    },
    {
      icon: FileText,
      title: "2. Log Sales (Deposit Taken)",
      description: "When a dealer takes a deposit on a sale, log it in the system. This creates a 'fingerprint' that's active for 120 days.",
      role: "Admin/Dealer",
    },
    {
      icon: BarChart3,
      title: "3. View Opportunities",
      description: "The app surfaces auction opportunities that match your fingerprints. Vehicles are flagged as 'Watch' or 'Buy' based on confidence scores.",
      role: "All",
    },
    {
      icon: Zap,
      title: "4. Watch → Buy Alerts",
      description: "When conditions improve and a vehicle flips from 'Watch' to 'Buy', alerts are queued for WhatsApp notification.",
      role: "Automatic",
    },
  ];

  const confidenceFactors = [
    { label: "Pass count ≥ 2", points: "+1" },
    { label: "Pass count ≥ 3", points: "+1" },
    { label: "Under-specified listing (score ≤ 1)", points: "+1" },
    { label: "Reserve dropped ≥ 5%", points: "+1" },
    { label: "Estimated margin ≥ $2,000", points: "+1" },
  ];

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <KitingWingMarkVideo size={48} />
          <div>
            <h1 className="text-2xl font-bold text-foreground">How to Use Carbitrage</h1>
            <p className="text-muted-foreground mt-1">
              Your auction intelligence system powered by Automotive Truth
            </p>
          </div>
        </div>

        {/* Workflow Steps */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {steps.map((step, idx) => (
              <div key={idx} className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-foreground">{step.title}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {step.role}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Matching Logic */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Strict Matching Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              A lot matches a fingerprint only when ALL of these conditions are met:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                <span>Make, Model, Variant, Engine, Drivetrain, Transmission all match exactly</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                <span>Year within ±1 of the sale</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                <span>KM ≤ sale_km + 15,000</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                <span>Fingerprint is active and not expired (120 days from sale)</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                <span>Estimated margin ≥ $1,000</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Confidence Score */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Confidence Score & Action</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Each opportunity gets a confidence score (0-5). Score ≥ 3 = <strong className="text-primary">BUY</strong>, otherwise <strong className="text-action-watch">WATCH</strong>.
            </p>
            <div className="space-y-2">
              {confidenceFactors.map((factor, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded bg-muted/30">
                  <span className="text-sm text-foreground">{factor.label}</span>
                  <span className="text-sm font-medium text-primary mono">{factor.points}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Alert Timing */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-5 w-5" />
              WhatsApp Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Active Hours: 7:00 AM - 7:00 PM AEST</p>
                <p className="text-xs text-muted-foreground">Alerts outside these hours are queued until the next window</p>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              <p>When a lot changes from WATCH → BUY, an alert is sent/queued:</p>
              <div className="mt-2 p-3 rounded bg-background border border-border font-mono text-xs">
                Carbitrage BUY NOW: 2021 Toyota Hilux SR5. Passed-in: 3. Est margin: $3,500. Link: [listing_url]
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Dedup: Same lot won't alert same recipient more than once in 24 hours.
            </p>
          </CardContent>
        </Card>

        {/* Roles */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Roles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h4 className="font-medium text-primary mb-2">Admin</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• See all opportunities</li>
                  <li>• Toggle visible_to_dealers</li>
                  <li>• View/manage all fingerprints</li>
                  <li>• Access alert log</li>
                  <li>• Deactivate fingerprints</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-muted/30 border border-border">
                <h4 className="font-medium text-foreground mb-2">Dealer</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• See only matched opportunities</li>
                  <li>• Log sales</li>
                  <li>• Receive WhatsApp alerts</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
