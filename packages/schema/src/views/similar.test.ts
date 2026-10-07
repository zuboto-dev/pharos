import { describe, expect, it } from 'vitest';
import { questionSimilarity, questionWords, similarAnswers } from './similar.js';

describe('similar questions', () => {
  it('keeps the words that carry meaning', () => {
    expect([...questionWords("What's overdue right now?")]).toEqual(['overdue']);
    expect([...questionWords('Which tasks are blocked?')]).toEqual(['task', 'blocked']);
  });

  it('matches rephrasings and tells different questions apart', () => {
    expect(questionSimilarity("What's overdue?", 'What is overdue right now?')).toBe(1);
    expect(questionSimilarity('Which tasks are blocked?', 'What tasks are blocked now?')).toBe(1);
    expect(questionSimilarity('Is M5 on track?', 'Are we on track for M5?')).toBe(1);
    expect(questionSimilarity("What's overdue?", 'Who is working on what?')).toBe(0);
    expect(questionSimilarity('What is left in M5?', 'What is left in M4?')).toBeLessThan(0.5);
  });

  it('lists the closest earlier answers first', () => {
    const answers = [
      { id: 'a', q: 'Who is working on what?' },
      { id: 'b', q: 'Which tasks are overdue in M5?' },
      { id: 'c', q: 'Which tasks are overdue?' },
    ];
    expect(similarAnswers('What tasks are overdue?', answers, (a) => a.q).map((a) => a.id)).toEqual(
      ['c', 'b'],
    );
  });
});
