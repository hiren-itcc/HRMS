/**
 * Integration specs talk to a real database over a real socket. 30s per test is
 * generous for that and still short enough that a hang fails rather than
 * stalling CI until the job timeout.
 */
jest.setTimeout(30_000);
