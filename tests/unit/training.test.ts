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

  it('gives a point a session, at most 5, inside the window', () => {
    // Deadlines Sat 7 Nov and Sat 14 Nov: GW10 is after the 7th, up to the 14th.
    const t = (trained_on: string, session = 1) => ({ trained_on, session });
    expect(trainingPoints([t('2026-11-10')], '2026-11-07', '2026-11-14')).toBe(1);
    // Both Tuesday sessions: 2. The same session twice: still 1.
    expect(trainingPoints([t('2026-11-10'), t('2026-11-10', 2)], '2026-11-07', '2026-11-14')).toBe(
      2,
    );
    expect(trainingPoints([t('2026-11-10'), t('2026-11-10')], '2026-11-07', '2026-11-14')).toBe(1);
    const all = [
      t('2026-11-08'),
      t('2026-11-08', 2),
      t('2026-11-10'),
      t('2026-11-10', 2),
      t('2026-11-12'),
    ];
    expect(trainingPoints(all, '2026-11-07', '2026-11-14')).toBe(5);
    expect(trainingPoints([...all, t('2026-11-13')], '2026-11-07', '2026-11-14')).toBe(5);
    expect(trainingPoints([t('2026-11-07'), t('2026-11-15')], '2026-11-07', '2026-11-14')).toBe(0);
  });

  it("numbers a day's sessions by start time", async () => {
    const { withSessions } = await import('@/lib/training');
    const out = withSessions([
      { date: '2026-11-10', time: '20:00', name: 'A' },
      { date: '2026-11-10', time: '19:00', name: 'B' },
      { date: '2026-11-12', time: '20:00', name: 'C' },
      { date: '2026-11-12', time: '', name: 'D' },
    ]);
    expect(out.map((c) => c.session)).toEqual([2, 1, 1, 1]);
  });

  it('has two sessions on Sunday and Tuesday, one on Thursday', async () => {
    const { sessionsOn } = await import('@/lib/training');
    expect(sessionsOn('2026-11-15')).toBe(2);
    expect(sessionsOn('2026-11-17')).toBe(2);
    expect(sessionsOn('2026-11-19')).toBe(1);
    expect(sessionsOn('2026-11-19', 2)).toBe(2);
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

describe('the training days in a gameweek', () => {
  it('is the Sunday, Tuesday and Thursday between two Saturday deadlines', async () => {
    const { scheduledDays } = await import('@/lib/training');
    // GW10 deadline Sat 14 Nov, GW11 Sat 21 Nov.
    expect(scheduledDays('2026-11-14', '2026-11-21')).toEqual([
      '2026-11-15',
      '2026-11-17',
      '2026-11-19',
    ]);
    // Christmas gap: every session between the two deadlines.
    expect(scheduledDays('2026-12-05', '2027-01-09')).toHaveLength(15);
    expect(scheduledDays(null, '2026-11-21')).toEqual(['2026-11-15', '2026-11-17', '2026-11-19']);
  });
});
