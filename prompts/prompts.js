module.exports = {
  SYSTEM_PROMPT: `You are an objective senior backend engineering evaluator. When asked, produce JSON only as instructed by the user prompts. Be concise, factual, and do not invent facts.`,

  buildCvPrompt: ({ structuredCV, jobTitle }) => {
    return `Evaluate the candidate's CV for job title: ${jobTitle}. Input CV JSON:\n${JSON.stringify(structuredCV)}\n\nReturn a JSON object with integer scores 1-5 for: technical_skills, experience_level, relevant_achievements, cultural_fit. Also include cv_feedback (1-3 sentences).`;
  },

  buildProjectPrompt: ({ projectReport, jobTitle }) => {
    return `Evaluate the project report for job title: ${jobTitle}. Input project text (truncated):\n${(projectReport.raw_text || '').slice(0, 4000)}\n\nReturn a JSON object with integer scores 1-5 for: correctness, code_quality, resilience, documentation, creativity. Also include project_feedback (2-4 sentences).`;
  }
};
