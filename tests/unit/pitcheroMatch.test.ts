import { namesClose, sameName } from '@/lib/pitcheroMatch';

describe('namesClose (one letter out, as names_close in 0036)', () => {
  it('links small spelling differences', () => {
    expect(namesClose('Denis Keegan', 'Dennis Keegan')).toBe(true);
    expect(namesClose('Zach Goode', 'Zack Goode')).toBe(true);
    expect(namesClose('Johnson-Last', 'Johnson Last')).toBe(true);
  });

  it("doesn't link nicknames, different people or short names", () => {
    expect(namesClose('Matt Souter', 'Matthew Souter')).toBe(false);
    expect(namesClose('Denis Keegan', 'Denis Keeling')).toBe(false);
    expect(namesClose('Al Li', 'Al Lu')).toBe(false);
    expect(namesClose('', 'Denis Keegan')).toBe(false);
  });

  it('tells an exact match apart', () => {
    expect(sameName('Denis  Keegan', 'denis keegan')).toBe(true);
    expect(sameName('Denis Keegan', 'Dennis Keegan')).toBe(false);
  });
});
