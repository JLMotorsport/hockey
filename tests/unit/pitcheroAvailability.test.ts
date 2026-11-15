import { exportDate, parseCsv, readAvailability } from '@/lib/pitcheroAvailability';

// The shape of Pitchero's export, with made-up people.
const csv = [
  '﻿"First name","Last name",Position,Teams,"Day availability","11:00 FHC Mens 2nd XI v Bye","12:45 FHC Mens 4th XI (Dev.) v Colchester 5","12:45 FHC Mens 4th XI (Dev.) v Colchester 5 selection","15:15 Broadland 2 v FHC Mens 3rd XI","15:15 Broadland 2 v FHC Mens 3rd XI selection",Note',
  'Amy,Out,,"FHC Mens 3rd XI","Not set","Not asked","Not asked",,Unavailable,,',
  'Ben,Picked,,"FHC Mens 3rd XI, FHC Mens 4th XI (Dev.)","Not set","Not asked",Unavailable,,Available,Unconfirmed,"needs a lift, ""please"""',
  'Cal,Maybe,,"FHC Mens 3rd XI, FHC Mens 4th XI (Dev.)","Not set","Not asked","Not sure",,Available,,',
  'Dee,Unsure,,"FHC Mens 3rd XI","Not set","Not asked","Not asked",,"Not sure",,',
  'Eve,Day,,"FHC Mens 2nd XI",Unavailable,"Not set","Not asked",,"Not asked",,',
  'Fay,Bye,,"FHC Mens 2nd XI","Not set",Unavailable,"Not asked",,"Not asked",,',
  'Gus,Yes,,"FHC Mens 3rd XI",Available,"Not asked","Not asked",,Available,,',
  'Hal,Silent,,"FHC Mens 3rd XI","Not set","Not asked","Not set",,"Not set",,',
].join('\r\n');

describe('Pitchero availability', () => {
  const rows = readAvailability(csv);
  const flagOf = (name: string) => rows.find((r) => r.name === name)?.flag;

  it('reads quoted cells, doubled quotes and the BOM', () => {
    expect(parseCsv('"a ""b""",c\r\nd,e')).toEqual([
      ['a "b"', 'c'],
      ['d', 'e'],
    ]);
    expect(rows).toHaveLength(8);
    expect(rows[0]!.name).toBe('Amy Out');
  });

  it('flags no to everything Out, not sure Doubtful', () => {
    expect(flagOf('Amy Out')).toBe('out');
    expect(flagOf('Dee Unsure')).toBe('doubtful');
    expect(flagOf('Eve Day')).toBe('out');
  });

  it('leaves alone anyone picked, or saying yes, or not answering', () => {
    expect(flagOf('Ben Picked')).toBeNull();
    expect(rows.find((r) => r.name === 'Ben Picked')!.why).toContain('FHC Mens 3rd XI');
    expect(flagOf('Gus Yes')).toBeNull();
    expect(flagOf('Hal Silent')).toBeNull();
  });

  it('flags yes for one side but not for another, not picked, Doubtful', () => {
    expect(flagOf('Cal Maybe')).toBe('doubtful');
  });

  it("ignores byes: they aren't matches", () => {
    expect(flagOf('Fay Bye')).toBeNull();
  });

  it('reads the date from the file name, and refuses other files', () => {
    expect(exportDate('availability-felixstowehockeyclub2-2026-11-21.csv')).toBe('2026-11-21');
    expect(exportDate('availability-felixstowehockeyclub2-2026-11-21_1.csv')).toBe('2026-11-21');
    expect(exportDate('availability-felixstowehockeyclub2-2026-11-21 (1).csv')).toBe('2026-11-21');
    expect(exportDate('track_and_trace.csv')).toBeNull();
    expect(() => readAvailability('date,time\n2026-11-10,20:00')).toThrow();
  });
});
