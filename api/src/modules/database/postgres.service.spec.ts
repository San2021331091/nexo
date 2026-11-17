import { isBrokenPoolError } from './postgres.service';

describe('isBrokenPoolError', () => {
  it('recognises a dead or ended pool', () => {
    expect(isBrokenPoolError(new Error('Cannot use a pool after calling end on the pool'))).toBe(true);
    expect(isBrokenPoolError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isBrokenPoolError(Object.assign(new Error('read failed'), { code: 'ECONNRESET' }))).toBe(true);
  });
  it('leaves ordinary query errors alone', () => {
    expect(isBrokenPoolError(new Error('relation "movies" does not exist'))).toBe(false);
    expect(isBrokenPoolError(new Error('duplicate key value violates unique constraint'))).toBe(false);
  });
});
