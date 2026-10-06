import { cardNames, fixtureCode, opponentCode, priceChange } from '@/lib/pickDisplay';

describe('pick card display', () => {
  it('makes three-letter opponent codes', () => {
    expect(opponentCode('Lowestoft Railway 1')).toBe('LOW');
    expect(opponentCode('Ipswich-East Suffolk N 3')).toBe('IES');
    expect(opponentCode('University of East Anglia Mens N 2')).toBe('UEA');
    expect(opponentCode('City of Peterborough 2')).toBe('PET');
    expect(opponentCode('Norwich City 5')).toBe('NOR');
  });

  it('labels a side’s fixture', () => {
    const f = {
      side_id: 1,
      gameweek_id: 5,
      opponent: 'Spalding 1',
      is_home: false,
      kickoff: '',
      goals_for: null,
      goals_against: null,
    };
    expect(fixtureCode([f], 1, 5)).toBe('SPA (A)');
    expect(fixtureCode([f], 2, 5)).toBe('No game');
    expect(fixtureCode([f, { ...f, opponent: 'Ely 2' }], 1, 5)).toBe('2 games');
  });

  it('uses surnames, with an initial only when two share one', () => {
    const names = cardNames([
      { id: 1, name: 'Sam Entwistle' },
      { id: 2, name: 'Sophie Entwistle' },
      { id: 3, name: 'Lucy Merritt' },
      { id: 4, name: 'Name withheld #7 (M1)' },
    ]);
    expect([...names.values()]).toEqual(['S. Entwistle', 'S. Entwistle', 'Merritt', 'Withheld']);
  });

  it('shows price changes', () => {
    expect(priceChange(2)).toBe('+0.2m');
    expect(priceChange(-1)).toBe('-0.1m');
    expect(priceChange(undefined)).toBe('0.0m');
  });
});
