import {it,expect} from 'vitest';
import {liveOrderFilter} from './live';
import {orderFilterClause,parseOrderFilters} from './filter';
it('excludes demo transactions while retaining Waffo and other real payment rails',()=>{
  const filters=parseOrderFilters(new URLSearchParams('method=waffo&status=paid'));
  expect(filters.method).toBe('waffo');
  const clause=liveOrderFilter(orderFilterClause(filters));
  expect(clause.params).toEqual(['waffo']);
  expect(clause.where).toContain("COALESCE(payment_method,'stripe') != 'demo'");
  expect(clause.where).toContain("status = 'paid'");
});
it('allows inspecting demo history without changing the default reporting scope',()=>{
  const filter={where:'WHERE payment_method = ?',params:['demo']};
  expect(liveOrderFilter(filter,true)).toEqual(filter);
  expect(liveOrderFilter({where:'',params:[]}).where).toMatch(/^WHERE /);
});
