/** Inputs are server-verified roles, never metadata or browser-stored role flags. */
export type DeskHomeDestination = 'desk' | 'yard-desk' | 'no-desk' | '/portal/login' | '/portal/buyer-view' | '/portal/wholesale/start';
export function deskHomeDestination(input: { signedIn: boolean; operatorRole: unknown; buyer: boolean; franchiseDealer: boolean; yardDesk?: boolean; yardMember?: boolean }): DeskHomeDestination {
  if (!input.signedIn) return '/portal/login';
  // Per-yard desk: confirmed by the operator-desk gateway from verified Ooglecars membership (or the owner record).
  // People with no dealership membership never get this, so pure buyers keep the buyer view.
  if (input.yardDesk) return 'yard-desk';
  // A wholesale buyer never inherits access from a second operator session in this browser.
  if (input.buyer) return '/portal/buyer-view';
  if (input.operatorRole === 'admin' || input.operatorRole === 'internal') return 'desk';
  if (input.yardMember) return 'no-desk';
  if (input.franchiseDealer) return '/portal/wholesale/start';
  return '/portal/login';
}
