import { sameTeamName } from '@/lib/account';

describe('sameTeamName', () => {
  it('matches the team name, ignoring case and stray spaces', () => {
    expect(sameTeamName(" little's lions ", "Little's Lions")).toBe(true);
    expect(sameTeamName("Little's Lion", "Little's Lions")).toBe(false);
    expect(sameTeamName('', "Little's Lions")).toBe(false);
  });
});
