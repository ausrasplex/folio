import { describe, expect, it } from 'vitest';
import { offsetPlan } from './loanmath';

const fixed = { id: 'fixed', rate: 6.41, benefit: false };
const variable = { id: 'variable', rate: 6.16, benefit: true };

describe('the order the offset fills splits in', () => {
  it('follows the statements: the split showing an offset benefit first, whatever the rates', () => {
    expect(offsetPlan('auto', [fixed, variable])).toEqual({ mode: 'listed', seq: ['variable', 'fixed'] });
  });
  it('is highest rate first until a statement shows a benefit, or when chosen', () => {
    expect(offsetPlan('auto', [fixed, { ...variable, benefit: false }]).mode).toBe('highestRate');
    expect(offsetPlan('high', [fixed, variable]).mode).toBe('highestRate');
  });
  it("keeps the loan's own order, and shares evenly when chosen (saved as 'pro')", () => {
    expect(offsetPlan('manual', [fixed, variable])).toEqual({ mode: 'listed', seq: ['fixed', 'variable'] });
    expect(offsetPlan('pro', [fixed, variable]).mode).toBe('proRata');
  });
});
