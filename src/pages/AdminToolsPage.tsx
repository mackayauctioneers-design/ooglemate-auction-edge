import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, FileSpreadsheet, Upload, RefreshCw, Wrench } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { PicklesCatalogueImport } from '@/components/lots/PicklesCatalogueImport';
import { LotCsvImport } from '@/components/lots/LotCsvImport';
import { LifecycleTest } from '@/components/lots/LifecycleTest';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

export default function AdminToolsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  
  const [showPicklesImport, setShowPicklesImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showLifecycleTest, setShowLifecycleTest] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // Redirect non-admins
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleDataChanged = () => {
    queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
    queryClient.invalidateQueries({ queryKey: ['lotFilterOptions'] });
    setShowPicklesImport(false);
    setShowCsvImport(false);
  };

  const handleRebuildSearchIndex = async () => {
    setIsRebuilding(true);
    try {
      // Invalidate all lot-related queries to force a fresh fetch
      await queryClient.invalidateQueries({ queryKey: ['auctionLots'] });
      await queryClient.invalidateQueries({ queryKey: ['lotFilterOptions'] });
      await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
      toast.success('Search index rebuilt successfully');
    } catch (error) {
      toast.error('Failed to rebuild search index');
    } finally {
      setIsRebuilding(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            Admin Tools
          </h1>
          <p className="text-sm text-muted-foreground">
            Administrative utilities for data management and testing
          </p>
        </div>

        {/* Tool Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Pickles Catalogue Import */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Pickles Catalogue Import
              </CardTitle>
              <CardDescription>
                Import lots from Pickles catalogue files (.docx, .xlsx, .csv, .txt)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setShowPicklesImport(true)}
                className="w-full gap-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Open Pickles Importer
              </Button>
            </CardContent>
          </Card>

          {/* CSV Import */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Upload className="h-5 w-5 text-primary" />
                Lots CSV Import
              </CardTitle>
              <CardDescription>
                Generic CSV import for auction lots data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setShowCsvImport(true)}
                variant="outline"
                className="w-full gap-2"
              >
                <Upload className="h-4 w-4" />
                Open CSV Importer
              </Button>
            </CardContent>
          </Card>

          {/* Lifecycle Test */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FlaskConical className="h-5 w-5 text-primary" />
                Lifecycle Test
              </CardTitle>
              <CardDescription>
                Run automated lifecycle tests on test lot data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setShowLifecycleTest(true)}
                variant="outline"
                className="w-full gap-2"
              >
                <FlaskConical className="h-4 w-4" />
                Run Lifecycle Test
              </Button>
            </CardContent>
          </Card>

          {/* Rebuild Search Index */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <RefreshCw className="h-5 w-5 text-primary" />
                Rebuild Search Index
              </CardTitle>
              <CardDescription>
                Force refresh all cached lot data and filter options
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={handleRebuildSearchIndex}
                variant="outline"
                className="w-full gap-2"
                disabled={isRebuilding}
              >
                <RefreshCw className={`h-4 w-4 ${isRebuilding ? 'animate-spin' : ''}`} />
                {isRebuilding ? 'Rebuilding...' : 'Rebuild Search Index'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Pickles Catalogue Import Dialog */}
        {showPicklesImport && (
          <PicklesCatalogueImport
            onClose={() => setShowPicklesImport(false)}
            onImported={handleDataChanged}
          />
        )}

        {/* CSV Import Dialog */}
        {showCsvImport && (
          <LotCsvImport
            onClose={() => setShowCsvImport(false)}
            onImported={handleDataChanged}
          />
        )}

        {/* Lifecycle Test Dialog */}
        <LifecycleTest
          open={showLifecycleTest}
          onOpenChange={setShowLifecycleTest}
          onComplete={handleDataChanged}
        />
      </div>
    </AppLayout>
  );
}
