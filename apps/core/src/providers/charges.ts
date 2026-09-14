import type { PublicCardToken } from './cardVault.ts';

export type ChargeDeclineReason = 'no_processor' | 'missing_token';

export interface ChargeResult {
  status: 'declined';
  reason: ChargeDeclineReason;
  code: 'not_configured' | 'missing_token';
  chargedPence: 0;
  currency: 'GBP';
  tokenId: string | null;
  last4: string | null;
  brand: string | null;
  message: string;
}

/**
 * A charge against a vault token. No processor is linked, so this never
 * contacts a card network and never takes money.
 */
export function declineCharge(token: PublicCardToken | null): ChargeResult {
  if (token === null) {
    return {
      status: 'declined',
      reason: 'missing_token',
      code: 'missing_token',
      chargedPence: 0,
      currency: 'GBP',
      tokenId: null,
      last4: null,
      brand: null,
      message: 'No saved card token. Add a card at checkout first. Nothing was charged.',
    };
  }
  return {
    status: 'declined',
    reason: 'no_processor',
    code: 'not_configured',
    chargedPence: 0,
    currency: 'GBP',
    tokenId: token.tokenId,
    last4: token.last4,
    brand: token.brand,
    message: 'No payment processor is linked. The card was not charged.',
  };
}
