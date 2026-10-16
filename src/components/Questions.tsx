import { cardMetrics, questionsOf } from '../lib/metrics';
import { setComprehension, useApp } from '../lib/store';
import { S } from '../strings';
import './Questions.css';

/**
 * The 2 or 3 oral questions after a paragraf card, with a right or wrong tap per answer. The same
 * taps show in Bacaan, right after the reading, and in Tinjau until the teacher confirms.
 */
export function Questions({ take_id, locked }: { take_id: string; locked: boolean }) {
  const app = useApp();
  const take = app.takes[take_id];
  if (!take) return null;
  const questions = questionsOf(take);
  if (!questions.length) return null;
  const answers = take.teacher.comprehension ?? [];
  const counted = cardMetrics(take).comprehension;
  return (
    <div className="qa">
      <ol className="qa__list">
        {questions.map((q, k) => (
          <li key={k} className="qa__row">
            <p className="qa__q">{q.q}</p>
            <p className="qa__a">{S.review.answer(q.a)}</p>
            <div className="qa__taps" role="group" aria-label={q.q}>
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  className="qa__tap"
                  data-value={value ? 'right' : 'wrong'}
                  aria-pressed={answers[k] === value}
                  disabled={locked}
                  onClick={() => setComprehension(take_id, k, answers[k] === value ? null : value)}
                >
                  {value ? S.review.right : S.review.wrong}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <p className="qa__count">{counted ? S.review.comprehensionCount(counted.correct, counted.asked) : S.review.comprehensionNone}</p>
    </div>
  );
}
