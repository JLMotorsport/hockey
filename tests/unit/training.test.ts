import {
  aliasKey,
  countedCheckIns,
  gameweekForDay,
  readCheckIns,
  trainingPoints,
} from '@/lib/training';

const csv = [
  '\uFEFFdate,time,type,event,firstname,lastname,location,end',
  '2026-11-10,19:00,training,"General Club Training",Ann,Able,"Felixstowe HC",20:00',
  '2026-11-10,20:00,training,"General Club Training",Bob,Baker,"Felixstowe HC",21:30',
  '2026-11-12,20:00,training,"Thursday Training",Cat,Cole,"Felixstowe HC",21:30',
  '2026-11-14,14:00,match,"FHC Mens 1st XI v March",Dan,Dale,"Felixstowe HC",16:00',
].join('\n');

describe('training check-ins', () => {
  it('reads the export and keeps every training session, not matches', () => {
    const all = readCheckIns(csv);
    expect(all).toHaveLength(4);
    expect(all[0]).toEqual({
      date: '2026-11-10',
      time: '19:00',
      type: 'training',
      event: 'General Club Training',
      name: 'Ann Able',
    });
    expect(countedCheckIns(all).map((c) => c.name)).toEqual(['Ann Able', 'Bob Baker', 'Cat Cole']);
    expect(() => readCheckIns('"First name","Last name"\nA,B')).toThrow();
  });

  it('gives a point a day, at most 2, inside the window', () => {
    // Deadlines Sat 7 Nov and Sat 14 Nov: GW10 is after the 7th, up to the 14th.
    expect(trainingPoints(['2026-11-10'], '2026-11-07', '2026-11-14')).toBe(1);
    expect(trainingPoints(['2026-11-10', '2026-11-10'], '2026-11-07', '2026-11-14')).toBe(1);
    expect(
      trainingPoints(['2026-11-08', '2026-11-10', '2026-11-12'], '2026-11-07', '2026-11-14'),
    ).toBe(2);
    expect(trainingPoints(['2026-11-07', '2026-11-15'], '2026-11-07', '2026-11-14')).toBe(0);
  });

  it('puts a training day in the gameweek whose deadline comes next', () => {
    const gws = [
      { id: 11, deadline: '2026-11-21T10:00:00Z' },
      { id: 10, deadline: '2026-11-14T09:30:00Z' },
    ];
    const uk = (iso: string) => iso.slice(0, 10);
    expect(gameweekForDay('2026-11-10', gws, uk)?.id).toBe(10);
    expect(gameweekForDay('2026-11-15', gws, uk)?.id).toBe(11);
    expect(gameweekForDay('2026-11-29', gws, uk)).toBeUndefined();
  });

  it('keys names by letters only', () => {
    expect(aliasKey('Becky  Walker-Smith')).toBe('beckywalkersmith');
  });
});

describe('suggesting who a Pitchero name is', () => {
  it('needs the surname and a plausible first name', async () => {
    const { likelySame } = await import('@/lib/training');
    expect(likelySame('Rebecca Walker', 'Becky Walker')).toBe(true);
    expect(likelySame('Tabitha Hayter', 'Tabby Hayter')).toBe(true);
    expect(likelySame('Daniel Cox', 'Dan Cox')).toBe(true);
    expect(likelySame('Daniel Cox', 'Helen Cox')).toBe(false);
    expect(likelySame('Rebecca Walker', 'Becky Walters')).toBe(false);
  });
});
