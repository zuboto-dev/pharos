/** Words that don't tell questions apart ("what is the…", "are we…"). */
const STOPWORDS = new Set(
  [
    'a an the is are was were be been do does did what whats which who whom how when where why',
    'we our us i me my you your it its this that these those there any anything to of in on for',
    'and or with at by from so right now currently still yet can could should would will please',
  ]
    .join(' ')
    .split(' '),
);

/** The words of a question that carry its meaning: lowercase, without punctuation or stopwords. */
export function questionWords(question: string): Set<string> {
  return new Set(
    question
      .toLowerCase()
      .replace(/['’]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
      .filter((w) => w && !STOPWORDS.has(w)),
  );
}

/** How alike two questions are, from 0 to 1 (shared meaningful words over all of them). */
export function questionSimilarity(a: string, b: string): number {
  const x = questionWords(a);
  const y = questionWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Questions alike enough that an earlier answer probably answers the new one. */
export const SIMILAR_QUESTION = 0.5;

/** Earlier answers to questions like `question`, most similar first. */
export function similarAnswers<T>(
  question: string,
  answers: T[],
  questionOf: (answer: T) => string | undefined,
): T[] {
  return answers
    .map((answer) => ({ answer, score: questionSimilarity(question, questionOf(answer) ?? '') }))
    .filter((s) => s.score >= SIMILAR_QUESTION)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.answer);
}
