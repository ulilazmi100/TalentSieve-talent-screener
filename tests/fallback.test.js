const { scoreCvHeuristic, scoreProjectHeuristic } = require('../src/fallback/scorer');

test('cv heuristic returns expected shape', () => {
  const sample = 'Experienced Node developer with 5 years experience, reduced latency by 30%.';
  const out = scoreCvHeuristic(sample);
  expect(out).toHaveProperty('technical_skills');
  expect(out).toHaveProperty('experience_level');
  expect(out.technical_skills).toBeGreaterThanOrEqual(1);
});

test('project heuristic returns expected shape', () => {
  const sample = 'Project includes unit tests and retry/backoff logic and a README.';
  const out = scoreProjectHeuristic(sample);
  expect(out).toHaveProperty('correctness');
  expect(out).toHaveProperty('project_feedback');
});
