/** Inputs are server-verified roles, never metadata or browser-stored role flags. */
export function deskHomeDestination(input: { signedIn: boolean; operatorRole: unknown; buyer: boolean; franchiseDealer: boolean }): 'desk' | '/portal/login' | '/portal/buyer-view' | '/portal/wholesale/start' {
  if (!input.signedIn) return '/portal/login';
  // A wholesale buyer never inherits access from a second operator session in this browser.
  if (input.buyer) return '/portal/buyer-view';
  if (input.operatorRole === 'admin' || input.operatorRole === 'internal') return 'desk';
  if (input.franchiseDealer) return '/portal/wholesale/start';
  return '/portal/login';
}