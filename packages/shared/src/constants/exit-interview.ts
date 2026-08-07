/**
 * The exit interview questionnaire.
 *
 * A shipped constant rather than a table, the same call `letter-templates.ts`
 * makes: the set is small, it changes rarely, and editing it is a release
 * rather than an afternoon in an admin screen nobody asked for.
 *
 * The *answers* freeze the question text alongside them, so changing this list
 * never rewrites what somebody already said. That is the important half — an
 * exit interview is evidence, and evidence whose question can be edited after
 * the fact is not evidence.
 */

export interface ExitInterviewQuestion {
  key: string;
  question: string;
  /** A prompt, not a constraint — every answer is free text. */
  hint?: string;
}

export const EXIT_INTERVIEW_QUESTIONS: ExitInterviewQuestion[] = [
  {
    key: 'reason',
    question: 'What is the main reason you decided to leave?',
    hint: 'The one that actually decided it, rather than the one on the form.',
  },
  {
    key: 'couldHaveStayed',
    question: 'Was there anything that could have changed your mind?',
  },
  {
    key: 'role',
    question: 'How did you find the work itself?',
  },
  {
    key: 'manager',
    question: 'How well were you supported by your manager?',
  },
  {
    key: 'team',
    question: 'How did you find working with your team?',
  },
  {
    key: 'growth',
    question: 'Did you get the growth and learning you expected?',
  },
  {
    key: 'improve',
    question: 'What is the one thing you would change about working here?',
  },
];

/** One answer, with the question it answered frozen beside it. */
export interface ExitInterviewResponse {
  key: string;
  question: string;
  answer: string;
}
