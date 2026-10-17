/** The delete/remove confirmation, as the database checks it: the team name, ignoring case and stray spaces. */
export const sameTeamName = (typed: string, team: string) =>
  typed.trim().toLowerCase() === team.trim().toLowerCase();
