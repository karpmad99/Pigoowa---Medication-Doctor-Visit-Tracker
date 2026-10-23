import { describe, expect, it } from 'vitest';
import { describeTimeInput, parseTimeInput } from './timeInput';

describe('parseTimeInput: accepted entries become HH:mm', () => {
  it.each([
    ['07:30', '07:30'],
    ['7:30', '07:30'],
    ['0730', '07:30'],
    ['730', '07:30'],
    ['7.30', '07:30'],
    ['07.30', '07:30'],
    ['  7:30  ', '07:30'],
    ['00:00', '00:00'],
    ['0:00', '00:00'],
    ['000', '00:00'],
    ['0000', '00:00'],
    ['23:59', '23:59'],
    ['2359', '23:59'],
    ['9.05', '09:05'],
    ['905', '09:05'],
    ['12:00', '12:00'],
    ['1200', '12:00'],
  ])('%j gives %s', (typed, normalised) => {
    expect(parseTimeInput(typed)).toBe(normalised);
  });

  it('gives the same result for every way of typing one time', () => {
    const results = new Set(['8:00', '08:00', '0800', '800', '8.00', ' 8:00 '].map(parseTimeInput));
    expect([...results]).toEqual(['08:00']);
  });
});

describe('parseTimeInput: everything else is refused, never guessed', () => {
  it.each([
    '',
    '   ',
    '7',
    '07',
    '18',
    '07:',
    '07:3',
    '7:5',
    '24:00',
    '2400',
    '7:60',
    '1260',
    '25:30',
    '2575',
    '960',
    '07:30:00',
    '0730 pm',
    '7,30',
    '07-30',
    '07/30',
    '7 30',
    '12::30',
    ':30',
    '07:300',
    '12345',
    'abc',
    '12:3a',
    '１２:３０', // full-width digits
    '+7:30',
    '-7:30',
  ])('%j is not a time', (typed) => {
    expect(parseTimeInput(typed)).toBeNull();
  });
});

describe('describeTimeInput: what kind of entry it is, for the messages', () => {
  it('knows an empty entry', () => {
    expect(describeTimeInput('')).toEqual({ kind: 'empty' });
    expect(describeTimeInput('   ')).toEqual({ kind: 'empty' });
  });

  it('knows a valid entry and its normalised time', () => {
    expect(describeTimeInput('730')).toEqual({ kind: 'valid', time: '07:30' });
  });

  it.each(['7', '07', '18', '7:', '07:', '7.', '07:3', '7.3'])(
    '%j is the start of a time: typing can continue',
    (typed) => {
      expect(describeTimeInput(typed)).toEqual({ kind: 'incomplete' });
    },
  );

  it.each(['24:00', '2400', '7:60', '1260', '99:99', '960'])(
    '%j has the shape of a time but no such time exists',
    (typed) => {
      expect(describeTimeInput(typed)).toEqual({ kind: 'out-of-range' });
    },
  );

  it.each(['abc', '07:30:00', '7-30', '7:5x', '12345', '7 30', ':30', '7,30'])(
    '%j does not look like a time',
    (typed) => {
      expect(describeTimeInput(typed)).toEqual({ kind: 'unrecognised' });
    },
  );
});
