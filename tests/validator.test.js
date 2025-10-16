const { validateCvOutput, validateProjectOutput } = require('../src/validators/validate');

test('valid cv passes validation', () => {
  const obj = { technical_skills: 4, experience_level: 3, relevant_achievements: 2, cultural_fit: 3, cv_feedback: 'ok' };
  const { valid } = validateCvOutput(obj);
  expect(valid).toBe(true);
});

test('invalid cv fails validation', () => {
  const obj = { technical_skills: 10 };
  const { valid, errors } = validateCvOutput(obj);
  expect(valid).toBe(false);
  expect(errors.length).toBeGreaterThan(0);
});
