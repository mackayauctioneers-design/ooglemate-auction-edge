import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deskHomeDestination } from '../../src/components/trading-desk/homeAccess.ts';
import { counterTrend, decisionTier, findsByDay, findsBySource, latestScanTime, marketTickerFigures, returnedFloorGap, sydneyFoundTime } from '../../src/components/trading-desk/deskPresentation.ts';

const who = { signedIn: true, operatorRole: null as unknown, buyer: false, franchiseDealer: false };
describe('Trading Desk home privacy', () => {
  it('owners/operators with existing verified admin or internal roles land on the desk', () => {
    assert.equal(deskHomeDestination({ ...who, operatorRole: 'admin' }), 'desk');
    assert.equal(deskHomeDestination({ ...who, operatorRole: 'internal' }), 'desk');
  });
  it('wholesale buyers keep their buyer pages, even with a second operator session', () => {
    assert.equal(deskHomeDestination({ ...who, buyer: true }), '/portal/buyer-view');
    assert.equal(deskHomeDestination({ ...who, buyer: true, operatorRole: 'admin', franchiseDealer: true }), '/portal/buyer-view');
  });
  it('signed-out visitors see sign-in, regardless of stale roles', () => {
    assert.equal(deskHomeDestination({ ...who, signedIn: false, operatorRole: 'admin' }), '/portal/login');
  });
  it('ordinary dealer and missing/failed roles cannot mount the operator desk', () => {
    assert.equal(deskHomeDestination({ ...who, operatorRole: 'dealer' }), '/portal/login');
    assert.equal(deskHomeDestination(who), '/portal/login');
    assert.equal(deskHomeDestination({ ...who, franchiseDealer: true }), '/portal/wholesale/start');
  });
});

const now = new Date('2026-11-23T05:49:00Z');
const rows = [
  { created_at: '2026-11-23T01:00:00Z', listing_source: 'carsales', tier: 'BUY', status: 'new', is_starred: false },
  { created_at: '2026-11-22T14:00:00Z', listing_source: 'pickles', tier: 'BUY', status: 'reviewed', is_starred: true },
  { created_at: '2026-11-21T01:00:00Z', listing_source: 'carsales', tier: 'WATCH', status: 'new', is_starred: false },
];
describe('Trading Desk presentation without invented data', () => {
  it('uses the canonical market counts and wholesale total, not bid observations', () => {
    assert.deepEqual(marketTickerFigures({ total_live_listings: 67086, retail_dealer_listings: 60863, auction_lots_open: 6223, added_last_24h: 2658, wholesale_price_points: { total: 2424 } }).map(figure => figure.value), [67086, 2658, 60863, 6223, 2424]);
  });
  it('drops inconsistent breakdowns rather than inventing corrected totals', () => {
    const figures = marketTickerFigures({ total_live_listings: 67086, retail_dealer_listings: 68863, auction_lots_open: 6223, added_last_24h: 2658, wholesale_price_points: { total: 2424 } });
    assert.deepEqual(figures.map(figure => figure.value), [67086, 2658, 2424]);
  });
  it('uses only an explicit scan timestamp, never the find or refresh time', () => {
    assert.equal(latestScanTime(rows), null);
    assert.equal(latestScanTime([{ last_scan_at: 'invalid' }, { last_scan_at: '2026-11-23T01:00:00Z' }, { last_scan_at: '2026-11-23T02:00:00Z' }]), '2026-11-23T02:00:00Z');
  });
  it('hides empty charts instead of inventing finds', () => { assert.deepEqual(findsByDay([], now), []); assert.deepEqual(findsBySource([]), []); });
  it('groups exactly seven days by Sydney date, not UTC', () => {
    const days = findsByDay(rows, now);
    assert.equal(days.length, 7);
    assert.equal(days.at(-1)?.count, 2);
    assert.equal(days.reduce((sum, day) => sum + day.count, 0), 3);
    assert.deepEqual(findsBySource(rows), [{ source: 'Carsales', count: 2 }, { source: 'Pickles', count: 1 }]);
  });
  it('uses returned tiers, never prices, to group BUY / WATCH / PASS', () => {
    assert.equal(decisionTier('HIGH'), 'BUY'); assert.equal(decisionTier('AUCTION_WATCH'), 'WATCH'); assert.equal(decisionTier('PASS'), 'PASS'); assert.equal(decisionTier('unknown'), null);
  });
  it('leaves absent floor gaps blank and never substitutes under-buy or median', () => {
    assert.deepEqual(returnedFloorGap({}), { dollars: null, percent: null });
    assert.deepEqual(returnedFloorGap({ floor_gap: 1800, floor_gap_pct: 6.2 }), { dollars: 1800, percent: 6.2 });
    assert.deepEqual(returnedFloorGap({ floor_gap: 0, floor_gap_pct: 0 }), { dollars: 0, percent: 0 });
  });
  it('shows no trend without observations and uses loaded 24h windows', () => { assert.equal(counterTrend([], 'BUY', now), null); assert.equal(counterTrend(rows, 'BUY', now), 'up'); });
  it('displays found times in Sydney daylight time', () => { assert.match(sydneyFoundTime('2026-11-23T01:00:00Z'), /12:00 pm/); });
});