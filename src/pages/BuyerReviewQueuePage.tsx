import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Check, X, Edit2, Loader2, Eye, Camera, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { formatCurrency } from '@/types';
import { Navigate } from 'react-router-dom';

interface ReviewRequest {
  id: string;
  dealer_name: string;
  vehicle_summary: string;
  frank_response: string;
  buy_range_min: number | null;
  buy_range_max: number | null;
  sell_range_min: number | null;
  sell_range_max: number | null;
  confidence: string;
  tier: string;
  parsed_vehicle: any;
  photo_paths: string[];
  status: string;
  admin_note: string | null;
  admin_buy_range_min: number | null;
  admin_buy_range_max: number | null;
  admin_response: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// Generate Bob's response for approved/adjusted reviews
function generateBobApprovalResponse(
  status: 'approved' | 'adjusted',
  buyMin: number,
  buyMax: number,
  originalBuyMin: number | null,
  originalBuyMax: number | null,
  adminNote: string | null
): string {
  if (status === 'approved') {
    return `Right, I've had eyes on the photos. The numbers stack up – I'd back ${formatCurrency(buyMin)} to ${formatCurrency(buyMax)} to buy it. You're good to go.`;
  } else {
    const direction = buyMin > (originalBuyMin || 0) ? 'up' : 'down';
    const noteText = adminNote ? ` ${adminNote}` : '';
    if (direction === 'down') {
      return `Had a look at the photos. I've come back a bit – ${formatCurrency(buyMin)} to ${formatCurrency(buyMax)} is where I'd want to be now.${noteText} The pictures told me something the numbers didn't.`;
    } else {
      return `Seen the photos now. Actually, I'd stretch a bit further – ${formatCurrency(buyMin)} to ${formatCurrency(buyMax)} looks fair.${noteText} She's tidy based on what I'm seeing.`;
    }
  }
}

function generateBobRejectionResponse(adminNote: string | null): string {
  const noteText = adminNote ? ` ${adminNote}` : '';
  return `Mate, I've seen the photos and I'm not putting a number on this one.${noteText} Sometimes the answer's just no. Move on to the next one.`;
}

export default function BuyerReviewQueuePage() {
  const { isAdmin, currentUser } = useAuth();
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<ReviewRequest | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Review form state
  const [reviewAction, setReviewAction] = useState<'approve' | 'adjust' | 'reject' | null>(null);
  const [adjustedBuyMin, setAdjustedBuyMin] = useState('');
  const [adjustedBuyMax, setAdjustedBuyMax] = useState('');
  const [adminNote, setAdminNote] = useState('');

  useEffect(() => {
    document.title = 'Buyer Review Queue | OogleMate';
    fetchRequests();
    return () => { document.title = 'OogleMate'; };
  }, []);

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('valo_review_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (err) {
      console.error('Error fetching requests:', err);
      toast.error('Failed to load review requests');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPhotoUrls = async (request: ReviewRequest) => {
    const urls: string[] = [];
    for (const path of request.photo_paths) {
      const { data } = await supabase.storage
        .from('valo-photos')
        .createSignedUrl(path, 3600); // 1 hour expiry
      if (data?.signedUrl) {
        urls.push(data.signedUrl);
      }
    }
    setPhotoUrls(urls);
  };

  const openReview = async (request: ReviewRequest) => {
    setSelectedRequest(request);
    setReviewAction(null);
    setAdjustedBuyMin(request.buy_range_min?.toString() || '');
    setAdjustedBuyMax(request.buy_range_max?.toString() || '');
    setAdminNote('');
    await loadPhotoUrls(request);
  };

  const handleSubmitReview = async () => {
    if (!selectedRequest || !reviewAction) return;
    if (!currentUser?.dealer_name) {
      toast.error('Not authenticated');
      return;
    }

    setIsProcessing(true);
    try {
      let adminResponse = '';
      const buyMin = parseFloat(adjustedBuyMin) || selectedRequest.buy_range_min || 0;
      const buyMax = parseFloat(adjustedBuyMax) || selectedRequest.buy_range_max || 0;

      if (reviewAction === 'approve') {
        adminResponse = generateBobApprovalResponse(
          'approved',
          selectedRequest.buy_range_min || 0,
          selectedRequest.buy_range_max || 0,
          selectedRequest.buy_range_min,
          selectedRequest.buy_range_max,
          null
        );
      } else if (reviewAction === 'adjust') {
        adminResponse = generateBobApprovalResponse(
          'adjusted',
          buyMin,
          buyMax,
          selectedRequest.buy_range_min,
          selectedRequest.buy_range_max,
          adminNote || null
        );
      } else {
        adminResponse = generateBobRejectionResponse(adminNote || null);
      }

      const updateData: any = {
        status: reviewAction === 'approve' ? 'approved' : reviewAction === 'adjust' ? 'adjusted' : 'rejected',
        admin_note: adminNote || null,
        admin_response: adminResponse,
        reviewed_by: currentUser.dealer_name,
        reviewed_at: new Date().toISOString(),
      };

      if (reviewAction === 'adjust') {
        updateData.admin_buy_range_min = buyMin;
        updateData.admin_buy_range_max = buyMax;
      }

      const { error: updateError } = await supabase
        .from('valo_review_requests')
        .update(updateData)
        .eq('id', selectedRequest.id);

      if (updateError) throw updateError;

      // Log the action
      await supabase.from('valo_review_logs').insert({
        request_id: selectedRequest.id,
        action: reviewAction === 'approve' ? 'approved' : reviewAction === 'adjust' ? 'adjusted' : 'rejected',
        actor: currentUser.dealer_name,
        note: adminNote || null,
        old_values: {
          buy_range_min: selectedRequest.buy_range_min,
          buy_range_max: selectedRequest.buy_range_max,
        },
        new_values: reviewAction === 'adjust' ? {
          buy_range_min: buyMin,
          buy_range_max: buyMax,
        } : null,
      });

      toast.success(`Review ${reviewAction}ed successfully`);
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      console.error('Error submitting review:', err);
      toast.error('Failed to submit review');
    } finally {
      setIsProcessing(false);
    }
  };

  // Redirect non-admins
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white">
              <Eye className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Buyer Review Queue</h1>
              <p className="text-muted-foreground">
                {pendingCount} pending review{pendingCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={fetchRequests}>
            Refresh
          </Button>
        </div>

        {/* Requests Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : requests.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Camera className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No review requests yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dealer</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Buy Range</TableHead>
                    <TableHead>Photos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.dealer_name}</TableCell>
                      <TableCell>{req.vehicle_summary}</TableCell>
                      <TableCell>
                        {req.buy_range_min && req.buy_range_max
                          ? `${formatCurrency(req.buy_range_min)} - ${formatCurrency(req.buy_range_max)}`
                          : 'N/A'
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{req.photo_paths.length} photos</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={
                            req.status === 'pending' ? 'outline' :
                            req.status === 'approved' ? 'default' :
                            req.status === 'adjusted' ? 'secondary' :
                            'destructive'
                          }
                          className={req.status === 'approved' ? 'bg-green-500' : ''}
                        >
                          {req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(req.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openReview(req)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Review Dialog */}
        <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            {selectedRequest && (
              <>
                <DialogHeader>
                  <DialogTitle>{selectedRequest.vehicle_summary}</DialogTitle>
                  <DialogDescription>
                    From {selectedRequest.dealer_name} • {new Date(selectedRequest.created_at).toLocaleString()}
                  </DialogDescription>
                </DialogHeader>

                {/* Bob's Original Response */}
                <Card className="bg-primary/5 border-primary">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary text-primary-foreground shrink-0">
                        <MessageSquare className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Bob's Response</p>
                        <p className="text-sm">{selectedRequest.frank_response}</p>
                        <div className="flex gap-2 mt-2">
                          <Badge variant="outline">{selectedRequest.confidence}</Badge>
                          <Badge variant="secondary">{selectedRequest.tier}</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Photos Grid */}
                <div>
                  <p className="text-sm font-medium mb-2">Photos ({photoUrls.length})</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {photoUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img 
                          src={url} 
                          alt={`Photo ${i + 1}`}
                          className="w-full h-32 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                </div>

                {/* Review Actions (only for pending) */}
                {selectedRequest.status === 'pending' && (
                  <div className="space-y-4 border-t pt-4">
                    <p className="text-sm font-medium">Review Action</p>
                    
                    <div className="flex gap-2">
                      <Button
                        variant={reviewAction === 'approve' ? 'default' : 'outline'}
                        onClick={() => setReviewAction('approve')}
                        className={reviewAction === 'approve' ? 'bg-green-500 hover:bg-green-600' : ''}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        variant={reviewAction === 'adjust' ? 'default' : 'outline'}
                        onClick={() => setReviewAction('adjust')}
                      >
                        <Edit2 className="h-4 w-4 mr-1" />
                        Adjust
                      </Button>
                      <Button
                        variant={reviewAction === 'reject' ? 'destructive' : 'outline'}
                        onClick={() => setReviewAction('reject')}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>

                    {reviewAction === 'adjust' && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Adjusted Buy Min</Label>
                          <Input
                            type="number"
                            value={adjustedBuyMin}
                            onChange={(e) => setAdjustedBuyMin(e.target.value)}
                            placeholder="e.g., 45000"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Adjusted Buy Max</Label>
                          <Input
                            type="number"
                            value={adjustedBuyMax}
                            onChange={(e) => setAdjustedBuyMax(e.target.value)}
                            placeholder="e.g., 48000"
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Note (optional)</Label>
                      <Textarea
                        value={adminNote}
                        onChange={(e) => setAdminNote(e.target.value)}
                        placeholder="Short note for the dealer..."
                        rows={2}
                      />
                    </div>
                  </div>
                )}

                {/* Already reviewed */}
                {selectedRequest.status !== 'pending' && selectedRequest.admin_response && (
                  <Card className="bg-muted">
                    <CardContent className="pt-4">
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        Bob's Final Response ({selectedRequest.status})
                      </p>
                      <p className="text-sm">{selectedRequest.admin_response}</p>
                      {selectedRequest.admin_note && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Note: {selectedRequest.admin_note}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Reviewed by {selectedRequest.reviewed_by} on{' '}
                        {selectedRequest.reviewed_at && new Date(selectedRequest.reviewed_at).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setSelectedRequest(null)}>
                    Close
                  </Button>
                  {selectedRequest.status === 'pending' && reviewAction && (
                    <Button 
                      onClick={handleSubmitReview}
                      disabled={isProcessing}
                      className={reviewAction === 'reject' ? 'bg-destructive' : reviewAction === 'approve' ? 'bg-green-500' : ''}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : null}
                      Submit Review
                    </Button>
                  )}
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}