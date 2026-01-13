/**
 * Auction-house-specific link handling utilities
 * 
 * Manheim requires session-based URLs and doesn't allow direct deep-linking to lots.
 * Pickles allows direct lot links.
 */

export interface AuctionLinkResult {
  url: string;
  requiresSession: boolean;
  message?: string;
}

// Manheim auction landing page base URLs
const MANHEIM_AUCTION_ROOTS: Record<string, string> = {
  default: 'https://www.manheim.com.au/for-buyers/find-a-car',
  brisbane: 'https://www.manheim.com.au/for-buyers/find-a-car?location=brisbane',
  sydney: 'https://www.manheim.com.au/for-buyers/find-a-car?location=sydney',
  melbourne: 'https://www.manheim.com.au/for-buyers/find-a-car?location=melbourne',
  perth: 'https://www.manheim.com.au/for-buyers/find-a-car?location=perth',
  adelaide: 'https://www.manheim.com.au/for-buyers/find-a-car?location=adelaide',
};

/**
 * Check if an auction house requires session-based URLs
 */
export function isSessionBasedAuctionHouse(auctionHouse: string | null | undefined): boolean {
  if (!auctionHouse) return false;
  const normalized = auctionHouse.toLowerCase().trim();
  return normalized.includes('manheim');
}

/**
 * Get the appropriate URL for an auction listing
 * For Manheim: returns the auction landing page instead of direct lot link
 * For others: returns the original listing URL
 */
export function getAuctionListingUrl(
  listingUrl: string | null | undefined,
  auctionHouse: string | null | undefined,
  location?: string | null
): AuctionLinkResult {
  // No URL provided
  if (!listingUrl) {
    return {
      url: '',
      requiresSession: false,
    };
  }

  // Check if Manheim
  if (isSessionBasedAuctionHouse(auctionHouse)) {
    // Get location-specific auction page or default
    const locationKey = location?.toLowerCase().trim() || 'default';
    const matchedLocation = Object.keys(MANHEIM_AUCTION_ROOTS).find(
      key => locationKey.includes(key)
    );
    
    const auctionPageUrl = matchedLocation 
      ? MANHEIM_AUCTION_ROOTS[matchedLocation]
      : MANHEIM_AUCTION_ROOTS.default;

    return {
      url: auctionPageUrl,
      requiresSession: true,
      message: 'Manheim requires login — opening auction search page',
    };
  }

  // Grays - also session-based but less strict
  if (auctionHouse?.toLowerCase().includes('grays')) {
    // Grays sometimes works, but flag it
    return {
      url: listingUrl,
      requiresSession: true,
      message: 'Grays may require login to view full details',
    };
  }

  // Default: use the original listing URL (Pickles, F3, Valley, etc.)
  return {
    url: listingUrl,
    requiresSession: false,
  };
}

/**
 * Get button label based on auction house
 */
export function getOpenButtonLabel(auctionHouse: string | null | undefined): string {
  if (isSessionBasedAuctionHouse(auctionHouse)) {
    return 'Open Auction Page';
  }
  return 'Open Listing';
}

/**
 * Get tooltip text for session-based auction houses
 */
export function getSessionWarningTooltip(auctionHouse: string | null | undefined): string | null {
  if (!auctionHouse) return null;
  
  const normalized = auctionHouse.toLowerCase().trim();
  
  if (normalized.includes('manheim')) {
    return 'Manheim requires login. Opens auction search page instead of direct lot link.';
  }
  
  if (normalized.includes('grays')) {
    return 'Grays may require login to view full details.';
  }
  
  return null;
}
