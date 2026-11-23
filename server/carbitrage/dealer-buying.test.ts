import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchingCars, summariseSales } from '../../src/components/dealer-buying/dealerProfile.ts';

const sale = (o: any) => ({ make: 'Toyota', model: 'Hilux', year: 2020, km: 50000, sale_price: 40000, days_to_clear: 20, transmission: null, ...o });
const s = summariseSales([sale({}), sale({ year: 2022, km: 90000 })]);

describe('dealer buying matches', () => {
  it('keeps only sold make/model inside the sold year and km range, best gap first', () => {
    const opps = [
      { id: 'a', make: 'TOYOTA', model: 'HILUX', year: 2021, km: 60000, best_under_buy: 1000 },
      { id: 'b', make: 'Toyota', model: 'Hilux', year: 2021, km: 70000, best_under_buy: 3000 },
      { id: 'c', make: 'Toyota', model: 'Hilux', year: 2019, km: 60000, best_under_buy: 9000 },
      { id: 'd', make: 'Toyota', model: 'Hilux', year: 2021, km: 120000, best_under_buy: 9000 },
      { id: 'e', make: 'Ford', model: 'Ranger', year: 2021, km: 60000, best_under_buy: 9000 },
    ];
    assert.deepEqual(matchingCars(opps, s).map((o) => o.id), ['b', 'a']);
  });
  it('returns nothing without sales history and caps at 50', () => {
    assert.equal(matchingCars([{ id: 'x', make: 'Toyota', model: 'Hilux', year: 2021, km: 1, best_under_buy: 1 }], summariseSales([])).length, 0);
    const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), make: 'Toyota', model: 'Hilux', year: 2021, km: 60000, best_under_buy: i }));
    assert.equal(matchingCars(many, s).length, 50);
  });
});
